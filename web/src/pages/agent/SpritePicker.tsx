import { Sprite } from '../../components/ui/domain';

export function SpritePicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="sprites" role="radiogroup" aria-label="Avatar de l’agent">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <label key={i} className="sprites__opt">
          <input type="radio" name="sprite" checked={value === i} onChange={() => onChange(i)} />
          <span className="sprites__face"><Sprite index={i} size={40} /></span>
          <span className="micro sprites__n">Profil {i + 1}</span>
        </label>
      ))}
    </div>
  );
}
