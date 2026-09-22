export function ErrorNotice({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <p role="alert" className="notice danger">
      {error.message}
      {onRetry ? (
        <>
          {" "}
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </>
      ) : null}
    </p>
  );
}
