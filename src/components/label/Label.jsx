const Label = ({
  elementName = 'No layer selected',
  color = '#2563eb',
  label = 'Selected layer',
  style = {},
}) => {
  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        pointerEvents: 'none',
        ...style,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: '#6b7280',
          marginBottom: 6,
          background: 'rgba(255, 255, 255, 0.7)',
          padding: '2px 6px',
          borderRadius: 999,
        }}
      >
        {label}
      </span>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'rgba(255, 255, 255, 0.9)',
          border: '1px solid rgba(15, 23, 42, 0.12)',
          boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
          borderRadius: 999,
          padding: '8px 12px',
          backdropFilter: 'blur(6px)',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: color,
            display: 'inline-block',
            boxShadow: '0 0 0 2px rgba(255,255,255,0.9)',
            flexShrink: 0,
          }}
        />

        <strong
          style={{
            color: '#111827',
            fontSize: 13,
            fontWeight: 800,
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
          }}
        >
          {elementName}
        </strong>
      </div>
    </div>
  );
};

export default Label;
