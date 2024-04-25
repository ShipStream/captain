import { CustomRaceConditionLock } from "../../src/coreUtils.js"

const unhandledRejectionToIgnore = [CustomRaceConditionLock.lockObsolete];

// preserve original setTimeout in case needed to be used when using fake timers
(global as any).originalSetTimeout = global.setTimeout
process.on('unhandledRejection', (error, origin) => {
  if (!unhandledRejectionToIgnore?.includes(`${error}`)) {
    console.error(origin, error)
    fail(error)  
  }
})
process.on('uncaughtException', (error, origin) => {
  console.error(origin, error)
  fail(error)
})
