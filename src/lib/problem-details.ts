import { NextResponse } from "next/server";

export type ProblemFieldErrors = Record<string, string[]>;

type ApiProblemInput = {
  status: number;
  title: string;
  detail: string;
  code: string;
  instance: string;
  errors?: ProblemFieldErrors;
  extensions?: Record<string, unknown>;
  headers?: HeadersInit;
  type?: string;
};

type ValidationProblemInput = Omit<
  ApiProblemInput,
  "status" | "title" | "code"
> & {
  status?: number;
  title?: string;
  code?: string;
};

function problemTypeForCode(code: string) {
  return `https://deepglot.ai/problems/${code.replaceAll("_", "-")}`;
}

/**
 * Returns the stable error envelope used by public and plugin-facing APIs.
 *
 * `error` intentionally aliases `detail` while older WordPress plugin versions
 * still read that field. New clients should use the Problem Details fields.
 */
export function apiProblem({
  status,
  title,
  detail,
  code,
  instance,
  errors,
  extensions,
  headers,
  type = problemTypeForCode(code),
}: ApiProblemInput) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/problem+json");

  return NextResponse.json(
    {
      ...extensions,
      type,
      title,
      status,
      detail,
      code,
      instance,
      error: detail,
      ...(errors ? { errors } : {}),
    },
    { status, headers: responseHeaders },
  );
}

export function validationProblem({
  status = 400,
  title = "Validation failed",
  code = "validation_failed",
  ...input
}: ValidationProblemInput) {
  return apiProblem({ status, title, code, ...input });
}
