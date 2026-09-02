const EXTENSION_URL = /(?:chrome|moz|safari-web)-extension:\/\//i;

function errorDetails(error: unknown): string {
  if (error instanceof Error) return `${error.message}\n${error.stack ?? ''}`;
  return typeof error === 'string' ? error : '';
}

/**
 * Whether a global browser error can be attributed to this application.
 *
 * Browser extensions share the page's global error channels. Treating every
 * unhandled extension rejection as ours lets a broken wallet/content script
 * stop a perfectly healthy battle, so unknown and explicitly external errors
 * are left to DevTools. Startup failures still go directly to showFatalError.
 */
export function isApplicationRuntimeError(
  error: unknown,
  source: string | undefined,
  applicationOrigin: string,
): boolean {
  const details = errorDetails(error);
  if (EXTENSION_URL.test(source ?? '') || EXTENSION_URL.test(details)) return false;

  if (source !== undefined && source.length > 0) {
    try {
      return new URL(source, applicationOrigin).origin === applicationOrigin;
    } catch {
      return false;
    }
  }

  // Promise rejections have no `filename`; modern browsers do retain the
  // absolute module URL in an Error stack, which is enough to establish that
  // the rejection came from our own bundle. Ambiguous errors are not fatal.
  return applicationOrigin.length > 0 && details.includes(applicationOrigin);
}
