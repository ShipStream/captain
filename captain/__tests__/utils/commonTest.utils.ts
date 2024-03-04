import console from 'console'
import {isAsyncFunction} from 'util/types'

// Used to match any argument value during method spy/stub 'call' matching algorithm
export const MATCH_ANY_VALUE = Symbol('match-any-value-jest-spy-call-args')

async function advanceBothRealAndFakeTime(millis: number) {
  let timePassed = 0
  const incrementByMillis = 100
  while (true) {
    // if using fake timers, advance both real and fake
    // else advance only real time.
    if (usingFakeTimers()) {
      await jest.advanceTimersByTimeAsync(incrementByMillis)
    }
    await new Promise((resolve) => (global as any).originalSetTimeout(resolve, incrementByMillis))
    timePassed += incrementByMillis
    if (timePassed >= millis) {
      return
    }
  }
}

async function passRealTimeInMillis(millis: number) {
  await new Promise((resolve) => (global as any).originalSetTimeout(resolve, millis))
}

const timerFakeAbleAPIList = [
  'Date',
  'hrtime',
  'nextTick',
  'performance',
  'queueMicrotask',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
]

function usingFakeTimers() {
  return (global.Date as any).isFake === true
}

// await given time in millis.
// works with both fake and real timer.
async function passTimeInMillis(millis: number) {
  if (usingFakeTimers()) {
    await jest.advanceTimersByTimeAsync(300)
  } else {
    await new Promise((resolve) => setTimeout(resolve, millis))
  }
}

function attentionLog(...mesages: any[]) {
  console.log(`@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n
${JSON.stringify(mesages, undefined, 2)}
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n`)
}

function getSpyDataForInstance(instanceObject: any, spiedPrototypFunction: jest.SpyInstance) {
  // shallow copy to avoid any potential mutations?
  const classMockData = {...spiedPrototypFunction.mock}
  const instanceMockData: Partial<jest.MockContext<any, any, any>> = {
    calls: [],
    results: [],
    instances: [],
    contexts: [],
  }
  classMockData.contexts?.map((eachContent: any, eachContextIndex: number) => {
    // // for debugging
    // if (eachContent?.toString() === instanceObject?.toString() || eachContent === instanceObject) {
    //   console.log('getSpyCallsForThisInstance:matching', {
    //     instanceObject: instanceObject.toString(),
    //     eachContent: eachContent.toString(),
    //     calls: calls[eachContextIndex],
    //     'equals': eachContent === instanceObject,
    //     'toStringEquals': eachContent?.toString() === instanceObject?.toString()
    //   })
    // }
    if (eachContent === instanceObject) {
      instanceMockData.calls?.push(classMockData.calls[eachContextIndex])
      instanceMockData.results?.push(classMockData.results[eachContextIndex]!)
      instanceMockData.instances?.push(classMockData.instances[eachContextIndex])
      instanceMockData.contexts?.push(classMockData.contexts[eachContextIndex])
    }
  })
  return instanceMockData
}

/**
 * Wait/PassTime until the given criteria succeeds or times out
 *
 * @param {Function} closurePredicate
 * @param {number} [timeOutInMs=10000]
 */
async function waitUntilPredicateSucceeds(closurePredicate: Function, timeOutInMs: number = 10000) {
  const logID = `waitUntilClosurePredicateSucceeds`
  const startTime = Date.now()
  while (true) {
    const timePassedInMs = Date.now() - startTime
    if (isAsyncFunction(closurePredicate)) {
      if (await closurePredicate()) return
    } else {
      if (closurePredicate()) return
    }
    if (timePassedInMs > timeOutInMs) {
      throw new Error(`TimeOut waiting for given predicate to succeed`)
    }
    await commonTest.passTimeInMillis(300)
  }
}

/**
 * This function should be considered an extension of jest and uses jest native types
 * Wait until the given instance method is called given 'times' and with given 'arguments'
 * Compatible with both real and fake timers of jest
 *
 * @template T
 * @template M
 * @param {T} targetInstance // prototype of the Class
 * @param {(M | Function)} targetMethodNameOrFunc // name of method as string
 * @param {(any[] | Function)} [requiredArgsOrPredicateFunc=[]]
 * @param {number} [times=1]
 * @param {number} [timeOutInMs=10000] // timeout waiting for the given call with the specified criteria
 * @return {*}  {(Promise<any[] | undefined>)}
 */
async function waitUntilCalled<T extends {}, M extends jest.FunctionPropertyNames<Required<T>>>(
  targetInstance: T,
  targetMethodNameOrFunc: M | Function,
  requiredArgsOrPredicateFunc: any[] | Function = [],
  times: number = 1,
  timeOutInMs: number = 10000
): Promise<any[] | undefined> {
  const classDotInstanceMethodName =
    typeof targetMethodNameOrFunc === 'function'
      ? 'givenMethod'
      : `${targetInstance.constructor.name}.${String(targetMethodNameOrFunc)}`
  const spyInstance = (
    typeof targetMethodNameOrFunc === 'function' ? targetMethodNameOrFunc : targetInstance[targetMethodNameOrFunc]
  ) as jest.SpyInstance
  const logID = `${classDotInstanceMethodName}`
  const startTime = Date.now()
  while (true) {
    const timePassedInMs = Date.now() - startTime
    const instanceSpyData = commonTest.getSpyDataForInstance(targetInstance, spyInstance)
    const matchingCalls: any[] | undefined = instanceSpyData.calls?.filter((argsList: any[]) => {
      let result = false
      if (typeof requiredArgsOrPredicateFunc === 'function') {
        const predicateFunction = requiredArgsOrPredicateFunc
        result = predicateFunction(argsList)
      } else {
        const requiredArgs = requiredArgsOrPredicateFunc
        result = argsList.every((invokedValue: any, invokedValueIndex: number) => {
          const requiredValue =
            requiredArgs?.length > invokedValueIndex ? requiredArgs[invokedValueIndex] : MATCH_ANY_VALUE
          const eachArgMatchResult =
            requiredValue === invokedValue ||
            requiredValue === MATCH_ANY_VALUE ||
            (Array.isArray(requiredValue) && commonTest.isArraysEqual(requiredValue, invokedValue))
          // console.log('waitUntilCalled:argsList.every', {
          //   invokedValueIndex,
          //   invokedValue,
          //   requiredValue,
          //   eachArgMatchResult,
          // })
          return eachArgMatchResult
        })
        // commonTest.attentionLog(`${logID}:changeCount`, {
        //   argsList: argsList.map((eachValue) => String(eachValue)),
        //   result,
        // })
      }
      return result
    })
    const matchingInvocationCount = matchingCalls?.length || 0
    console.log(`${logID}:waitUntilCalled`, {matchingCalls, matchingInvocationCount})
    if (matchingInvocationCount >= times) {
      console.log(`${logID}:waitUntilCalled`, {
        'instanceSpyData.calls?.length': instanceSpyData.calls?.length,
        matchingInvocationCount,
        // matchingCalls: JSON.stringify(matchingCalls)
      })
      return matchingCalls
    }
    if (timePassedInMs > timeOutInMs) {
      // include argument information in error if possible
      const argumentInfo = typeof requiredArgsOrPredicateFunc !== 'function' ? ` for args: ${
        (requiredArgsOrPredicateFunc as any).map((eachValue: any) => String(eachValue))
      }` : ' matching given criteria'
      throw new Error(
        `TimeOut waiting for "${classDotInstanceMethodName}" to be called '${times}' time(s)${argumentInfo}`
      )
    }
    await commonTest.passTimeInMillis(300)
  }
}

function isArraysEqual(arrayOne: any[], arrayTwo: any[]) {
  const result =
    arrayOne?.every((val: any) => arrayTwo?.includes(val)) && arrayTwo?.every((val: any) => arrayOne?.includes(val))
  return result
}

const commonTest = {
  advanceBothRealAndFakeTime,
  passRealTimeInMillis,
  timerFakeAbleAPIList,
  passTimeInMillis,
  usingFakeTimers,
  attentionLog,
  getSpyDataForInstance,
  waitUntilCalled,
  waitUntilPredicateSucceeds,
  isArraysEqual,
}

export default commonTest
