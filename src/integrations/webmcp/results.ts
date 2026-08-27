export interface ToolSuccess<T> {
  success: true;
  data: T;
}

export interface ToolErrorDetail {
  code: string;
  message: string;
  suggestions: string[];
}

export interface ToolFailure {
  success: false;
  error: ToolErrorDetail;
}

export type ToolResult<T> = ToolSuccess<T> | ToolFailure;

export function toolSuccess<T>(data: T): ToolSuccess<T> {
  return { success: true, data };
}

export function toolFailure(
  code: string,
  message: string,
  suggestions: string[] = [],
): ToolFailure {
  return { success: false, error: { code, message, suggestions } };
}
