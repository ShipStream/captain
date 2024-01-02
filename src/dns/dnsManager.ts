import appConfig from '../appConfig.js'
import cloudflareDnsManager from './cloudflareDnsManager.js'
import technitiumDnsManager from './technitiumDnsManager.js'

export interface DnsManager {
  /**
   * Live dns query to get all resolved ip's for a given zone record
   */
  resolvedAddresses(zoneRecord: string): Promise<string[]>
  /**
   * Add new zone record
   */
  addZoneRecord(zoneRecord: string, address: string): Promise<void>
  /**
   * Convenience method for multiple new zone records
   */
  addZoneRecordMulti(zoneRecord: string, addresses: string[]): Promise<void>
  /**
   * Remove zone record
   */
  removeZoneRecord(zoneRecord: string, address: string): Promise<void>
  /**
   * Convenience method for removing multiple zone records
   */
  removeZoneRecordMulti(zoneRecord: string, addresses: string[]): Promise<void>
  /**
   * Custom validation/setup, specific for each dns provider
   */
  validateDnsConf(): Promise<void>
}

export let dnsManager!: DnsManager

/**
 * Choose the dns provider based on ENVIRONMENT and initialize it
 */
export async function initializeDnsManager() {
  const dnsProviderName = appConfig.DNS_PROVIDER
  switch (dnsProviderName) {
    case 'technitium':
      dnsManager = technitiumDnsManager
      await dnsManager.validateDnsConf()
      break
    case 'cloudflare':
      dnsManager = cloudflareDnsManager
      await dnsManager.validateDnsConf()
      break
    default:
      throw new Error('Unsupported dns provider')
  }
}
