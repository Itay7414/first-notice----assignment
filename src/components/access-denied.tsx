export function AccessDenied({
  message = "Access Denied: Please sign in to view the claims dashboard.",
}: {
  message?: string;
}) {
  return <p className="text-sm text-muted-foreground">{message}</p>;
}
