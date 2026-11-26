"""Exécution d'un client officiel en sous-processus : isolée dans son propre cgroup via `systemd-run --user`
(mémoire et processus plafonnés, durée maximale), avec repli explicite et visible sur un sous-processus simple."""
from __future__ import annotations

import asyncio
import os
import signal
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .config import Settings
from .providers.base import Command

STDERR_KEEP = 8192


@dataclass
class ExecResult:
    returncode: int
    stderr_tail: str
    timed_out: bool
    cancelled: bool


class Executor:
    def __init__(self, settings: Settings):
        self.s = settings
        self.mode = "plain"
        self.detail = ""
        uid = os.getuid()
        self._user_env = {
            "XDG_RUNTIME_DIR": os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{uid}"),
            "DBUS_SESSION_BUS_ADDRESS": os.environ.get("DBUS_SESSION_BUS_ADDRESS", f"unix:path=/run/user/{uid}/bus"),
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": str(settings.agent_home),
        }

    async def detect(self) -> None:
        want = self.s.isolate
        if want == "none":
            self.mode, self.detail = "plain", "isolation désactivée par configuration"
            return
        ok, why = await self._probe_systemd()
        if ok:
            self.mode, self.detail = "systemd", f"cgroup par exécution (MemoryMax={self.s.run_mem_max}, TasksMax={self.s.run_tasks_max})"
        elif want == "systemd":
            raise RuntimeError(f"systemd-run --user indisponible : {why}")
        else:
            self.mode, self.detail = "plain", f"repli sans cgroup : {why}"

    async def _probe_systemd(self) -> tuple[bool, str]:
        try:
            p = await asyncio.create_subprocess_exec("systemd-run", "--user", "--wait", "--collect", "--quiet", "-p", "MemoryMax=64M",
                                                     "/bin/true", env=self._user_env, stdout=asyncio.subprocess.PIPE,
                                                     stderr=asyncio.subprocess.STDOUT, stdin=asyncio.subprocess.DEVNULL)
            out, _ = await asyncio.wait_for(p.communicate(), 20)
            return (p.returncode == 0), out.decode("utf-8", "replace").strip()[:200]
        except Exception as e:  # noqa: BLE001
            return False, str(e)

    # ------------------------------------------------------------------
    def _wrap(self, cmd: Command, unit: str, cwd: Path, timeout_s: int) -> tuple[list[str], dict[str, str]]:
        if self.mode == "plain":
            return cmd.argv, cmd.env
        argv = ["systemd-run", "--user", "--pipe", "--wait", "--collect", "--quiet", "--unit", unit,
                "-p", f"MemoryMax={self.s.run_mem_max}", "-p", "MemorySwapMax=0", "-p", f"TasksMax={self.s.run_tasks_max}",
                "-p", f"RuntimeMaxSec={timeout_s + 30}", "-p", "PrivateTmp=yes", "-p", "NoNewPrivileges=yes",
                "--working-directory", str(cwd)]
        hidden = [self.s.config_dir, self.s.db_path, Path(f"{self.s.db_path}-wal"), Path(f"{self.s.db_path}-shm"), self.s.data_dir.parent / "backups"]
        paths = " ".join(f"-{p}" for p in [*map(str, hidden), *cmd.hide])  # « - » : chemin ignoré s'il n'existe pas
        argv += ["-p", f"InaccessiblePaths={paths}"]
        for k, v in cmd.env.items():
            argv += ["-E", f"{k}={v}"]
        argv += ["--", *cmd.argv]
        return argv, self._user_env

    async def _stop_unit(self, unit: str) -> None:
        try:
            p = await asyncio.create_subprocess_exec("systemctl", "--user", "stop", f"{unit}.service", env=self._user_env,
                                                     stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
            await asyncio.wait_for(p.wait(), 20)
        except Exception:  # noqa: BLE001
            pass

    async def stop_stale_units(self) -> None:
        if self.mode != "systemd":
            return
        try:
            p = await asyncio.create_subprocess_exec("systemctl", "--user", "stop", "roai-run-*.service", env=self._user_env,
                                                     stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
            await asyncio.wait_for(p.wait(), 20)
        except Exception:  # noqa: BLE001
            pass

    async def run(self, cmd: Command, *, unit: str, cwd: Path, timeout_s: int, on_line: Callable[[str], None],
                  cancel: asyncio.Event) -> ExecResult:
        argv, env = self._wrap(cmd, unit, cwd, timeout_s)
        proc = await asyncio.create_subprocess_exec(*argv, cwd=str(cwd), env=env, stdin=asyncio.subprocess.PIPE,
                                                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                                                    start_new_session=True, limit=1 << 24)
        err = bytearray()

        async def feed() -> None:
            try:
                if cmd.stdin is not None and proc.stdin:
                    proc.stdin.write(cmd.stdin.encode("utf-8"))
                    await proc.stdin.drain()
                if proc.stdin:
                    proc.stdin.close()
            except (BrokenPipeError, ConnectionResetError):
                pass

        async def rd_out() -> None:
            assert proc.stdout
            while True:
                try:
                    raw = await proc.stdout.readline()
                except ValueError:  # ligne démesurée : on l'ignore
                    await proc.stdout.read(1 << 20)
                    continue
                if not raw:
                    return
                try:
                    on_line(raw.decode("utf-8", "replace"))
                except Exception:  # noqa: BLE001 - un défaut d'analyse ne doit jamais tuer l'exécution
                    pass

        async def rd_err() -> None:
            assert proc.stderr
            while True:
                chunk = await proc.stderr.read(4096)
                if not chunk:
                    return
                err.extend(chunk)
                if len(err) > STDERR_KEEP:
                    del err[: len(err) - STDERR_KEEP]

        readers = [asyncio.create_task(feed()), asyncio.create_task(rd_out()), asyncio.create_task(rd_err())]
        waiter = asyncio.create_task(proc.wait())
        cancel_w = asyncio.create_task(cancel.wait())
        done, _ = await asyncio.wait({waiter, cancel_w}, timeout=timeout_s, return_when=asyncio.FIRST_COMPLETED)
        timed_out = cancelled = False
        if waiter not in done:
            cancelled = cancel_w in done
            timed_out = not cancelled
            await self._terminate(proc, unit)
        cancel_w.cancel()
        try:
            await asyncio.wait_for(asyncio.gather(*readers, return_exceptions=True), 15)
        except asyncio.TimeoutError:
            for t in readers:
                t.cancel()
        rc = await waiter
        return ExecResult(returncode=rc, stderr_tail=err.decode("utf-8", "replace").strip(), timed_out=timed_out, cancelled=cancelled)

    async def _terminate(self, proc: asyncio.subprocess.Process, unit: str) -> None:
        if self.mode == "systemd":
            await self._stop_unit(unit)
        else:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        try:
            await asyncio.wait_for(proc.wait(), 8)
        except asyncio.TimeoutError:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
