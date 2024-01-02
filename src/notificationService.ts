import {logger} from './coreUtils.js'
import {WebServiceManager} from './web-service/webServiceManager.js'

/**
 * Slack/Datadog/Generic HTTP success notification
 */
export async function notifyFailOverSucceeded(
  webService: WebServiceManager,
  ipAddress: string,
  failOverIPAddress: string
) {
  // TODO
  logger.info('<==================SUCCESS=====================>')
  logger.info('Slack/Datadog/Generic HTTP success notification', {
    serviceKey: webService.serviceKey,
    serviceName: webService.serviceConf.name,
    zoneRecord: webService.serviceConf.zone_record,
    ipAddress,
    failOverIPAddress,
  })
  logger.info('<==================SUCCESS=====================>')
}

/**
 * Slack/Datadog/Generic HTTP failure notification
 */
export async function notifyFailOverFailed(
  webService: WebServiceManager,
  ipAddress: string,
  failOverIPAddress: string | undefined,
  reason: string
) {
  // TODO
  logger.info('<==================FAILURE====================>')
  logger.info('Slack/Datadog/Generic HTTP failure notification', {
    serviceKey: webService.serviceKey,
    serviceName: webService.serviceConf.name,
    zoneRecord: webService.serviceConf.zone_record,
    ipAddress,
    failOverIPAddress,
    reason,
  })
  logger.info('<==================FAILURE====================>')
}
