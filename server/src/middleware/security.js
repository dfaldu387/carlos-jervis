/**
 * Baseline security headers.
 *
 * Applied to every response. These are the low-cost defences the requirements
 * call for - no content sniffing, no framing, a tight referrer policy, and a
 * conservative permissions policy. A full CSP belongs with the deployment
 * decision, so it is not asserted here where it would only be half right.
 */
export const securityHeaders = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
};
