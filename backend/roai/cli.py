"""Outils d'administration : `python3 -m roai.cli set-password`."""
from __future__ import annotations

import getpass
import os
import pwd
import secrets
import sys

import typer

from .config import Settings
from .web import write_auth

app = typer.Typer(add_completion=False, help="Administration RO·AI")


@app.callback()
def _main() -> None:
    """Outils d'administration RO·AI."""


@app.command("set-password")
def set_password(username: str = typer.Option("admin", help="Nom d'utilisateur du Control Center"),
                 generate: bool = typer.Option(False, "--generate", help="Générer un mot de passe aléatoire et l'afficher une fois")):
    """Définit le mot de passe du Control Center (à lancer en root)."""
    s = Settings.from_env()
    if generate:
        pw = secrets.token_urlsafe(18)
    else:
        pw = getpass.getpass("Nouveau mot de passe (12 caractères minimum) : ")
        if pw != getpass.getpass("Confirmer : "):
            typer.echo("Les mots de passe diffèrent.", err=True)
            raise typer.Exit(1)
    if len(pw) < 12:
        typer.echo("Mot de passe trop court (12 caractères minimum).", err=True)
        raise typer.Exit(1)
    write_auth(s.web_state_dir, username, pw)
    if os.geteuid() == 0:
        u = pwd.getpwnam("ro-ai-web")
        for p in (s.web_state_dir, s.web_state_dir / "auth.json"):
            os.chown(p, u.pw_uid, u.pw_gid)
    typer.echo(f"Mot de passe défini pour « {username} ».")
    if generate:
        typer.echo(pw)


if __name__ == "__main__":
    app()
