import { notFound } from "next/navigation";

import { isTestLoginEnabled } from "@/lib/test-login-config";
import { CreateApiKeyDialog } from "@/components/projekte/create-api-key-dialog";

/**
 * QA-only harness page. Renders the "create API key" dialog in isolation so
 * it can be exercised by Playwright without a database or authenticated
 * session. Gated behind the same flag as the test-login button (dev /
 * preview / DEEPGLOT_ENABLE_TEST_LOGIN=true) so it never ships reachable in
 * production.
 */
export default function ApiKeyDialogQaPage() {
  if (!isTestLoginEnabled()) {
    notFound();
  }

  return (
    <div className="flex min-h-screen items-start justify-center bg-gray-50 p-10">
      <CreateApiKeyDialog projectId="qa-project" />
    </div>
  );
}
