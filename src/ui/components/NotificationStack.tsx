import type { SimulationStore } from "../../sim/store";
import { useSimulationSnapshot } from "../hooks/useSimulationSnapshot";

interface NotificationStackProps {
  store: SimulationStore;
}

export function NotificationStack({ store }: NotificationStackProps) {
  const snapshot = useSimulationSnapshot(store);

  return (
    <section
      aria-label="Notifications"
      aria-live="polite"
      data-testid="notification-stack"
      style={{
        position: "absolute",
        bottom: 24,
        right: 24,
        zIndex: 4,
        display: "flex",
        flexDirection: "column-reverse",
        alignItems: "stretch",
        gap: 8,
        width: "min(320px, calc(100vw - 48px))",
        pointerEvents: "none",
      }}
    >
      {snapshot.notifications.map((notification) => (
        <div
          key={notification.id}
          role="status"
          data-testid={`notification-${notification.id}`}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "10px 12px",
            border: "1px solid rgba(229, 242, 246, 0.28)",
            borderRadius: 6,
            background: "rgba(16, 24, 32, 0.92)",
            color: "#f5f7fa",
            fontFamily: "system-ui, sans-serif",
            fontSize: "0.9rem",
          }}
        >
          <span>{notification.message}</span>
          <button
            type="button"
            aria-label={`Dismiss ${notification.message}`}
            data-testid={`notification-dismiss-${notification.id}`}
            onClick={() => store.dispatch({ type: "dismissNotification", id: notification.id })}
            style={{
              pointerEvents: "auto",
              flex: "0 0 auto",
              border: 0,
              background: "transparent",
              color: "#f5f7fa",
              cursor: "pointer",
              font: "inherit",
              fontSize: "1.1rem",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </section>
  );
}

export default NotificationStack;
