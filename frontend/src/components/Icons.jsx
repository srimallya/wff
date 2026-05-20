const paths = {
  back: 'M15 18l-6-6 6-6M9 12h12',
  chat: 'M7 8h10M7 12h6M5 20l3-3h9a4 4 0 004-4V7a4 4 0 00-4-4H7a4 4 0 00-4 4v6a4 4 0 004 4h1',
  check: 'M5 13l4 4L19 7',
  close: 'M6 6l12 12M18 6L6 18',
  delete: 'M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3',
  edit: 'M4 20h4l10-10a2.8 2.8 0 00-4-4L4 16v4zM13 7l4 4',
  enter: 'M10 17l5-5-5-5M15 12H3M21 3v18',
  forum: 'M4 6h16v10H8l-4 4V6z',
  globe: 'M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c3 3 4.5 6 4.5 9S15 18 12 21M12 3c-3 3-4.5 6-4.5 9S9 18 12 21',
  home: 'M3 11l9-8 9 8M5 10v10h14V10M9 20v-6h6v6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  profile: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35',
  send: 'M4 12l16-8-5 16-3-7-8-1zM12 13l8-9',
  spark: 'M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2z',
  support: 'M12 21s-8-4.6-8-11a5 5 0 019-3 5 5 0 019 3c0 6.4-8 11-8 11z',
}

export function Icon({ name, className = 'h-5 w-5', title }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={paths[name] || paths.spark} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconButton({ icon, label, className = '', ...props }) {
  return (
    <button {...props} aria-label={label} title={label} className={`icon-button ${className}`}>
      <span className="icon-button-label">{label}</span>
    </button>
  )
}
