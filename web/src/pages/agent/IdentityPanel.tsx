// Section « Fiche d'identité » de la configuration d'un agent (chargée à la demande : elle embarque le dessin des portraits du bureau).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Agent } from '../../api/types';
import { Button, Panel, Tag } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { Portrait } from '../../office/ui/Portrait';
import { useAgentProfile } from '../../office/ui/panel/useAgentProfile';
import { GenerationBox, ProfileEditor } from '../../office/ui/panel/ProfileEditor';
import { SOURCE_HINT, SOURCE_LABEL } from '../../office/ui/panel/profileForm';
import '../../office/ui/panel/panel.css';

export default function IdentityPanel({ agent, openSignal = 0 }: { agent: Agent; openSignal?: number }) {
  const ctl = useAgentProfile(agent.id, undefined, undefined, agent.provider);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (openSignal > 0) setEditing(true); }, [openSignal]);
  const p = ctl.profile;
  return (
    <Panel title="Fiche d’identité" id="s-identity" className="cp-page" meta={p && <Tag tone={p.source === 'generated' ? 'info' : p.source === 'manual' ? 'ok' : 'neutral'} title={SOURCE_HINT[p.source]}>{SOURCE_LABEL[p.source]}</Tag>}>
      {!p ? <p className="faint" style={{ fontSize: 12.5 }}>{ctl.loadError ?? 'Chargement de la fiche…'}</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="cp-idcard">
            <Portrait sprite={agent.avatar?.sprite ?? 0} size={64} appearance={p.appearance} />
            <div className="cp-idcard__text">
              <b className="untrusted">{p.display_name || agent.name}</b>
              <span className="dim untrusted" style={{ fontSize: 12.5 }}>{p.title || '—'}</span>
              <span className="faint mono" style={{ fontSize: 12 }}>{[p.employee_id, p.office && `bureau ${p.office}`].filter(Boolean).join(' · ') || '—'}</span>
            </div>
          </div>
          {p.bio && <p className="untrusted dim" style={{ fontSize: 12.5, margin: 0, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.bio}</p>}
          <GenerationBox ctl={ctl} provider={agent.provider} compact />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button size="sm" onClick={() => setEditing(true)}>Modifier la fiche…</Button>
            <Link to="/office"><Button size="sm" variant="ghost">Voir dans le bureau</Button></Link>
          </div>
          <p className="faint" style={{ fontSize: 12 }}>Décorative : utilisée seulement par le Bureau virtuel, jamais transmise à l’agent ni ajoutée à ses prompts.</p>
        </div>
      )}
      {editing && p && (
        <Modal title={`Fiche d’identité · ${agent.name}`} wide onClose={() => setEditing(false)}>
          <div className="cp-page">
            <ProfileEditor agentId={agent.id} sprite={agent.avatar?.sprite ?? 0} provider={agent.provider} ctl={ctl} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />
          </div>
        </Modal>
      )}
    </Panel>
  );
}
