export function getClientIp(request: Request): string {
  const firstForwardedAddress = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  return firstForwardedAddress || "unknown";
}
