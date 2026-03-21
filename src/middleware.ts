export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    "/((?!login|api/auth|api/telegram|api/cron|api/import-file|api/import-blob|api/import-blob-token|_next/static|_next/image|favicon.ico|public).*)",
  ],
};
