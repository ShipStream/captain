import {checkAndPromoteToLeader, customFetch, logger, promoteThisCaptainToLeader} from './coreUtils.js'
import appConfig from './appConfig.js'
import appState from './appState.js'

const CONSUL_QUERY_STATUS = {
  SUCCESS: 0,
  SERVICE_UNAVAILABLE: 1,
  UNKNOWN_ERROR: 3,
}

export class ConsulService {
  static getConsulReadConfURL() {
    if (appConfig.CONSUL_HTTP_ADDR) {
      return `${appConfig.CONSUL_HTTP_ADDR}/v1/agent/self`
    }
  }

  /**
   * Wrapper over node 'fetch' customized for typical response from consul
   */
  private async consulFetch(url: string, init?: RequestInit): Promise<{status: number; data?: any; error?: any}> {
    try {
      const logID = 'Consul Service'
      const jsonResponse = await customFetch(logID, url, init)
      return {
        status: CONSUL_QUERY_STATUS.SUCCESS,
        data: jsonResponse,
      }
    } catch (e: any) {
      if (`${e?.cause?.code}` === 'ECONNREFUSED' || `${e?.cause?.code}` === 'ENOTFOUND') {
        logger.error('Consul Service: customFetch', e?.cause?.code, url)
        return {
          status: CONSUL_QUERY_STATUS.SERVICE_UNAVAILABLE,
          error: e,
        }
      }
      return {
        status: CONSUL_QUERY_STATUS.UNKNOWN_ERROR,
        error: e,
      }
    }
  }

  /**
   * Use the alternative algorithm to choose leader if consul not available.
   *
   * @memberof ConsulService
   */
  async fallbackAlgorithmIfNoLeader() {
    // no leader already elected, use fallback algo.
    // dont' use this algorith, if there is a leader already, as potentially only a single consul instance could be 'down' instead of the cluster.
    if (!appState.getLeaderUrl()) {
      await checkAndPromoteToLeader()
    }
  }

  async reAffirmLeadership() {
    const response = await this.consulFetch(ConsulService.getConsulReadConfURL()!)
    if (response.status === CONSUL_QUERY_STATUS.SUCCESS) {
      const consul = response?.data?.Stats?.consul
      const isLeaderByConsul = consul?.leader === 'true'
      logger.info('reAffirmLeadership:isLeaderByConsul', isLeaderByConsul)
      return isLeaderByConsul
    }
    return false
  }

  async handleLatestConsulStats() {
    let raceCondLock
    try {
      raceCondLock = await appState.getRaceHandler().getLock('handleLatestConsulStats')
      const response = await this.consulFetch(ConsulService.getConsulReadConfURL()!)
      if (response.status === CONSUL_QUERY_STATUS.SUCCESS) {
        const consul = response?.data?.Stats?.consul
        const isLeaderByConsul = consul?.leader === 'true'
        logger.info('handleLatestConsulStats:consul.isLeader', isLeaderByConsul)
        if (isLeaderByConsul) {
          if (!appState.isLeader()) {
            // if not already a leader, promote to leader
            await promoteThisCaptainToLeader()
          } else {
            logger.info('Already the leader nothing to do.')
          }
        }
      } else if (response.status === CONSUL_QUERY_STATUS.SERVICE_UNAVAILABLE) {
        logger.warn('handleLatestConsulStats:CONSUL_QUERY_STATUS.SERVICE_UNAVAILABLE. Use fallbackAlgorithm')
        await this.fallbackAlgorithmIfNoLeader()
      } else {
        // Unknown case, better to throw and stop rather then use fallback, as could be an unintended error scenario
        logger.error('handleLatestConsulStats', response)
        throw new Error('Error getting latest consul status', {cause: response.error})
      }
    } finally {
      appState.getRaceHandler().releaseLock(raceCondLock)
    }
  }

  async initiatePollConsulStatsForChange() {
    logger.info('initiatePollConsulStatsForChange:4', new Date())
    // run once immedietely and await it
    await this.handleLatestConsulStats()
    // initiate the polling after the first run
    setInterval(this.handleLatestConsulStats, appConfig.CONSUL_LEADER_INTERVAL * 1000)
  }

  constructor() {
    this.handleLatestConsulStats = this.handleLatestConsulStats.bind(this)
  }

  /**
   * Factory to create captain socket server
   */
  public static async createConsulService() {
    const consulService = new ConsulService()
    await consulService.initiatePollConsulStatsForChange()
    return consulService
  }
}
