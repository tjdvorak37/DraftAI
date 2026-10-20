import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export function IconButton({ icon: Icon, label, active, className = '', ...props }) {
  return <button className={`icon-button ${active ? 'active' : ''} ${className}`} title={label} aria-label={label} {...props}><Icon size={17} strokeWidth={1.7} /></button>;
}

export function Modal({ title, subtitle, onClose, children, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    const close = event => { event.preventDefault(); onClose(); };
    dialog.addEventListener('cancel', close);
    return () => dialog.removeEventListener('cancel', close);
  }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} onClick={event => { if (event.target === ref.current) onClose(); }}><div className="modal-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton icon={X} label="Close dialog" onClick={onClose} /></div>{children}</dialog>;
}