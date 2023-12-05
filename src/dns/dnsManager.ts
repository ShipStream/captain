import appConfig from '../appConfig.js'
import cloudflareDnsManager from './cloudflareDnsManager.js'
import technitiumDnsManager from './technitiumDnsManager.js'

export interface DnsManager {
  addZoneRecord(zoneRecord: string, address: string): void
  addZoneRecordMulti(zoneRecord: string, addresses: string []): void
  removeZoneRecord(zoneRecord: string, address: string): void
}

export let dnsManager!: DnsManager

export function initializeDnsManager() {
  const dnsProviderName = appConfig.DNS_PROVIDER
  switch(dnsProviderName){
    case 'technitium':
      dnsManager = technitiumDnsManager
      break;  
    case 'technitium':
      dnsManager = cloudflareDnsManager
      break;    
    default:
      throw new Error('Unsupported dns provider')
  }
}