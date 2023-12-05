import appConfig from "./appConfig.js"
import { setLeaderUrl } from "./appState.js"
import { broadcastNewLeader } from "./socket/captainSocketServerManager.js"

/**
 *
 * Simple console logger with sentry integration for errors alone
 *
 * @class Logger
 */
class Logger {
  /**
   * Logs message with priority 'debug' to console
   *
   * @param {*} message
   * @param {*} params
   * @memberof Logger
   */
  debug(message: any, ...params: any []) {
    console.log(message, ...params)
  }

  /**
   * Logs message with priority 'info' to console
   *
   * @param {*} message
   * @param {*} params
   * @memberof Logger
   */
  info(message: any, ...params: any []) {
    console.log(message, ...params)
  }

  /**
   * Logs message with priority 'warn' to console
   *
   * @param {*} message
   * @param {*} params
   * @memberof Logger
   */
  warn(message: any, ...params: any []) {
    console.warn(message, ...params)
  }

  /**
   * Logs message with priority 'error' to console
   *
   * @param {*} message
   * @param {*} params
   * @memberof Logger
   */
  error(message: any, ...params: any []) {
    console.error(message, ...params)
  }

}

export const logger = new Logger()

export function checkAndPromoteToLeader() {
  if (appConfig.MEMBER_URLS[0] === appConfig.SELF_URL) {
    console.log('checkAndPromoteToLeader', 'I AM LEADER')  
    setLeaderUrl(appConfig.SELF_URL)
    broadcastNewLeader(appConfig.SELF_URL)
  }
}