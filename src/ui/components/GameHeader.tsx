import { PRODUCT_NAME, PRODUCT_SHORT_NAME } from "../../content/product";

export function GameHeader() {
  return (
    <header
      aria-label={`${PRODUCT_NAME} game header`}
      role="banner"
      style={{
        position: "absolute",
        inset: "24px auto auto 24px",
        zIndex: 1,
        pointerEvents: "none",
        color: "#f5f7fa",
        fontFamily: "system-ui, sans-serif",
        textShadow: "0 2px 8px rgba(0, 0, 0, 0.65)",
        userSelect: "none",
      }}
    >
      <h1 style={{ margin: 0, fontSize: "clamp(2rem, 4vw, 3rem)", lineHeight: 1 }}>
        {PRODUCT_NAME}
      </h1>
      <span
        aria-label={`Short label: ${PRODUCT_SHORT_NAME}`}
        style={{
          display: "block",
          marginTop: "8px",
          fontSize: "1rem",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
        }}
      >
        {PRODUCT_SHORT_NAME}
      </span>
    </header>
  );
}

export default GameHeader;
