const FILTER_MARK = Symbol.for("absensi-universal.libsignal-log-filter");

function installLibsignalLogFilter(consoleObject = console) {
  if (consoleObject[FILTER_MARK]) return () => {};
  const originalInfo = consoleObject.info;
  const originalWarn = consoleObject.warn;

  function containsSignalSession(args) {
    return (
      ["Closing session:", "Opening session:", "Session already closed"].includes(args[0]) &&
      args.some((value) => value?.constructor?.name === "SessionEntry")
    );
  }

  consoleObject.info = function secureInfo(...args) {
    if (!containsSignalSession(args)) return originalInfo.apply(this, args);
  };
  consoleObject.warn = function secureWarn(...args) {
    if (!containsSignalSession(args)) return originalWarn.apply(this, args);
  };
  consoleObject[FILTER_MARK] = true;

  return () => {
    consoleObject.info = originalInfo;
    consoleObject.warn = originalWarn;
    delete consoleObject[FILTER_MARK];
  };
}

module.exports = { installLibsignalLogFilter };
