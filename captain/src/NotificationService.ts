import appConfig from './appConfig.js'
import {logger, customFetch} from './coreUtils.js'
import {WebServiceManager} from './web-service/webServiceManager.js'

export class NotificationService {
  static isSlackConfigured() {
    return !!(appConfig.SLACK_TOKEN && appConfig.SLACK_CHANNEL_ID)
  }
  
  static isDatadogConfigured() {
    return !!(appConfig.DATADOG_SITE && appConfig.DATADOG_API_KEY)
  }
  
  static isGenericNotificationConfigured() {
    return !!(appConfig.NOTIFICATION_URL)
  }  

  static getSlackMessageUrl() {
    if (appConfig.SLACK_BASE_URL) {
      return `${appConfig.SLACK_BASE_URL}/chat.postMessage`
    }
  }
  
  static getDatadogEventUrl() {
    if (appConfig.DATADOG_SITE) {
      return `${appConfig.DATADOG_SITE}/api/v1/events`
    }
  }
  
  static getGenericNotificationUrl() {
    if (appConfig.NOTIFICATION_URL) {
      return appConfig.NOTIFICATION_URL
    }
  }  

  constructDatadogEvent(input: {
    zoneRecord: string
    serviceTags: string[]
    success: boolean
    serviceName: string
    added?: string[]
    removed?: string[]
    errorMessage?: string
  }) {
    const added = input.added ? `Added: ${input.added}, ` : ''
    const removed = input.removed ? `Removed: ${input.removed}` : ''
    const errorMessage = input.errorMessage ? `Error: ${input.errorMessage}` : ''
    return {
      title: 'DNS failover',
      ...(input.success
        ? {
            text: `DNS record for ${input.serviceName} (${input.zoneRecord}) updated. ${added}${removed}`,
          }
        : {
            text: `DNS record update failed for ${input.serviceName} (${input.zoneRecord}) ${added}${removed}.
  ${errorMessage}`,
          }),
      alert_type: 'user_update',
      tags: ['captain', ...input.serviceTags],
    }
  }

  async postDatadogEvent(input: {
    zoneRecord: string
    serviceTags: string[]
    success: boolean
    serviceName: string
    added?: string[]
    removed?: string[]
    errorMessage?: string
  }) {
    if (!NotificationService.isDatadogConfigured()) {
      logger.warn('Not sending "Datadog Notification" as related "env" variables not configured.', { serviceName: input.serviceName, serviceZoneRecord: input.zoneRecord })
      return
    }
    const logID = `Datadog Service:serviceName=${input.serviceName}:zoneRecord=${input.zoneRecord}`
    try {
      const fullUrl = NotificationService.getDatadogEventUrl()!
      const jsonResponse = await customFetch(logID, fullUrl, {
        method: 'POST',
        body: JSON.stringify(this.constructDatadogEvent(input)),
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          'DD-API-KEY': appConfig.DATADOG_API_KEY,
        },
      })
      if (jsonResponse.status !== 'ok') {
        throw new Error(
          `Datadog Service: ${jsonResponse.errors || 'Unknown Error'}: Details: ${JSON.stringify({
            ...jsonResponse,
            fullUrl,
          })}`
        )
      }
      logger.debug('datadog:postEvent', jsonResponse)
    } catch(e) {
      logger.info('Error: Datadog notification', { serviceName: input.serviceName, serviceZoneRecord: input.zoneRecord, e })
    }
  }

  constructSlackMessage(input: {
    zoneRecord: string
    success: boolean
    description: string
    added?: string[]
    removed?: string[]
    errorMessage?: string
  }) {
    return `# DNS failover ${input.success ? 'succeeded' : 'failed'}
  **${input.description}**
  Captain ${input.success ? 'updated' : 'attempted to update'} the DNS record for ${input.zoneRecord}.
  - Added: ${input.added ? input.added : 'none'}
  - Removed: ${input.removed ? input.removed : 'none'}
  ${input.errorMessage}
  `
  }

  async postSlackMessage(input: {
    zoneRecord: string
    success: boolean
    description: string
    added?: string[]
    removed?: string[]
    errorMessage?: string
  }) {
    try {
      if (!NotificationService.isSlackConfigured()) {
        logger.warn('Not sending "Slack Notification" as related "env" variables not configured.', { serviceZoneRecord: input.zoneRecord })
        return
      }
      const logID = 'Slack Service'
      const fullUrl = NotificationService.getSlackMessageUrl()!
      const jsonResponse = await customFetch(logID, fullUrl, {
        headers: {
          Authorization: `Bearer ${appConfig.SLACK_TOKEN}`,
          'Content-Type': 'application/json;charset=UTF-8',
        },
        method: 'POST',
        body: JSON.stringify({
          channel: appConfig.SLACK_CHANNEL_ID,
          text: this.constructSlackMessage(input),
        }),
      })
      if (!jsonResponse.ok) {
        // another 'ok' in normal response
        throw new Error(
          `${logID}: ${jsonResponse.error || 'Unknown Error'}: Details: ${JSON.stringify({...jsonResponse, fullUrl})}`
        )
      }
      logger.debug('slackService:postMessage', jsonResponse)
    } catch(e) {
      logger.info('Error: Slack notification', { serviceZoneRecord: input.zoneRecord, e })
    }
  }

  async postGenericHttpNotification(data: {
    status: 'success' | 'failure'
    name: string
    description: string
    tags: string[]
    zone_record: string
    added?: string[]
    removed?: string[]
    error_message?: string
  }) {
    try {
      if (!NotificationService.isGenericNotificationConfigured()) {
        logger.warn('Not sending "Generic Post Notification" as related "env" variables not configured.', { serviceName : data.name, serviceZoneRecord: data.zone_record })
        return
      }
      const logID = 'Generic Post Notification'
      const response = await customFetch(logID, NotificationService.getGenericNotificationUrl()!, {
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          ...appConfig.NOTIFICATION_HEADER ? JSON.parse(appConfig.NOTIFICATION_HEADER) : {},
        },
        method: 'POST',
        body: JSON.stringify(data),
      })
      logger.debug('customNotificationFetch', response)
    } catch(e) {
      logger.info('Error: Generic HTTP notification', { serviceName : data.name, serviceZoneRecord: data.zone_record, e })
    }
  }

  constructor() {}

  /**
   * Slack/Datadog/Generic HTTP success notification
   */
  async notifyFailOverSucceeded(
    webService: WebServiceManager,
    preFailOverIPAddress: string,
    added: string [],
    removed: string [],
  ) {
    // TODO
    logger.info('<==================SUCCESS=====================>')
    const serviceName = webService.serviceConf.name
    const serviceTags = webService.serviceConf.tags
    const zoneRecord = webService.serviceConf.zone_record
    logger.info('Slack/Datadog/Generic HTTP success notification', {
      serviceKey: webService.serviceKey,
      serviceName,
      serviceTags,
      zoneRecord,
      added,
      removed,
    })
    await this.postSlackMessage({
      zoneRecord,
      success: true,
      description: 'Successfully updated records',
      added,
      removed,
    })
    await this.postDatadogEvent({
      zoneRecord,
      serviceTags,
      success: true,
      serviceName,
    })
    await this.postGenericHttpNotification({
      status: 'success',
      name: serviceName,
      description: 'Successfully updated records',
      tags: serviceTags,
      zone_record: zoneRecord,
      added,
      removed,
    })
    logger.info('<==================SUCCESS=====================>')
  }

  /**
   * Slack/Datadog/Generic HTTP failure notification
   */
  async notifyFailOverFailed(
    webService: WebServiceManager,
    preFailOverIPAddress: string,
    ipsAdded?: string [],
    ipsRemoved?: string [],
    reason?: string
  ) {
    // TODO
    logger.info('<==================FAILURE====================>')
    const serviceName = webService.serviceConf.name
    const serviceTags = webService.serviceConf.tags
    const zoneRecord = webService.serviceConf.zone_record
    logger.info('Slack/Datadog/Generic HTTP failure notification', {
      serviceKey: webService.serviceKey,
      serviceName,
      serviceTags,
      zoneRecord,
      added: ipsAdded,
      removed: ipsRemoved,
      reason,
    })
    await this.postSlackMessage({
      zoneRecord,
      success: false,
      description: 'Failover unsuccessful',
      added: ipsAdded,
      removed: ipsRemoved,
      errorMessage: reason,
    })
    await this.postDatadogEvent({
      zoneRecord,
      serviceTags,
      success: false,
      serviceName,
      errorMessage: reason,
    })
    await this.postGenericHttpNotification({
      status: 'failure',
      name: serviceName,
      description: 'Failover unsuccessful',
      tags: serviceTags,
      zone_record: zoneRecord,
      added: ipsAdded,
      removed: ipsRemoved,
      error_message: reason,
    })
    logger.info('<==================FAILURE====================>')
  }

  /**
   * Factory to create the notification service
   */
  public static async createNotificationService() {
    const notificationService = new NotificationService()
    return notificationService
  }
}
