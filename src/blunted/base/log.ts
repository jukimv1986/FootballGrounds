// Port of blunted/base/log.

export enum e_LogType {
  e_Notice,
  e_Warning,
  e_Error,
  e_FatalError,
}

export type LogCallback = (logType: e_LogType, className: string, methodName: string, message: string) => void;

const callbacks: LogCallback[] = [];
let verbose = false;

export function SetLogVerbose(on: boolean): void {
  verbose = on;
}

export function BindLog(callback: LogCallback): () => void {
  callbacks.push(callback);
  return () => {
    const i = callbacks.indexOf(callback);
    if (i >= 0) callbacks.splice(i, 1);
  };
}

export function Log(logType: e_LogType, className: string, methodName: string, message: string): void {
  for (const cb of callbacks) cb(logType, className, methodName, message);
  const text = `[${className}::${methodName}] ${message}`;
  switch (logType) {
    case e_LogType.e_Notice:
      if (verbose) console.info(text);
      break;
    case e_LogType.e_Warning:
      console.warn(text);
      break;
    case e_LogType.e_Error:
      console.error(text);
      break;
    case e_LogType.e_FatalError:
      console.error(text);
      throw new Error(text);
  }
}

// convenience aliases matching the C++ enum constant names
export const e_Notice = e_LogType.e_Notice;
export const e_Warning = e_LogType.e_Warning;
export const e_Error = e_LogType.e_Error;
export const e_FatalError = e_LogType.e_FatalError;
