import {logger} from './../coreUtils.js'
import {isLeader} from './../appState.js'
import {DnsManager} from './dnsManager.js'

let sessionToken: string
const TECHNITIUM_CUSTOM_ZONE_NAME = 'ops'
const TECHNITIUM_BASE_URL = 'http://10.5.0.2:5380'

/**
 * Wrapper over node 'fetch' customized for typical response from technitium
 */
async function customFetch(url: NodeJS.fetch.RequestInfo, init?: RequestInit) {
  const response = await fetch(`${TECHNITIUM_BASE_URL}${url}`, init)
  if (response.ok) {
    const jsonResponse: any = await response.json()
    // logger.info('customFetch:', url, jsonResponse)
    if (jsonResponse.status === 'ok') {
      return jsonResponse
    } else {
      throw jsonResponse
    }
  } else {
    const responseText = await response.text()
    logger.info('customFetch:error', {
      responseText,
      statusText: response.statusText,
    })
    throw new Error(`Error with dns server: ${responseText || response.statusText || 'Unknown Error'}`)
  }
}

/**
 * Get/Cache session token
 */
async function getSessionToken() {
  if (sessionToken) {
    return sessionToken
  } else {
    const response = await customFetch('/api/user/login?user=admin&pass=admin&includeInfo=true')
    // logger.info('getSessionToken', {
    //   response,
    // })
    sessionToken = response.token
    return sessionToken
  }
}

/**
 * Live dns query to get all resolved ip's for a given zone record
 */
async function resolvedAddresses(zoneRecord: string): Promise<string[]> {
  const token = await getSessionToken()
  const params = new URLSearchParams({
    token,
    zone: TECHNITIUM_CUSTOM_ZONE_NAME,
    domain: zoneRecord,
  }).toString()
  // logger.info('resolvedAddresses', params)
  const resolvedAddressesResponse = await customFetch(`/api/zones/records/get?${params}`)
  // logger.info('resolvedAddresses', {
  //   resolvedAddressesResponse,
  // })
  return resolvedAddressesResponse?.response?.records
    ?.map((eachRecord: any) => {
      return eachRecord.rData?.ipAddress
    })
    .filter((eachIPAddress: string) => !!eachIPAddress)
}

/**
 * Add new zone record
 */
async function addZoneRecord(zoneRecord: string, ipAddress: string) {
  const token = await getSessionToken()
  const params = new URLSearchParams({
    token,
    zone: TECHNITIUM_CUSTOM_ZONE_NAME,
    domain: zoneRecord,
    ipAddress: ipAddress,
    type: 'A',
    ttl: '60',
  }).toString()
  // logger.info('addZoneRecord', params)
  const addZoneRecordResponse = await customFetch(`/api/zones/records/add?${params}`)
  logger.info('addZoneRecord', {
    addZoneRecordResponse,
  })
}

/**
 * Convenience method for multiple new zone records
 */
async function addZoneRecordMulti(zoneRecord: string, ipAddresses: string[]) {
  await Promise.all(ipAddresses.map((eachIpAddress) => addZoneRecord(zoneRecord, eachIpAddress)))
}

/**
 * Remove zone record
 */
async function removeZoneRecord(zoneRecord: string, ipAddress: string) {
  const token = await getSessionToken()
  const params = new URLSearchParams({
    token,
    zone: TECHNITIUM_CUSTOM_ZONE_NAME,
    domain: zoneRecord,
    ipAddress: ipAddress,
    type: 'A',
  }).toString()
  // logger.info('removeZoneRecord', params)
  const removeZoneRecordResponse = await customFetch(`/api/zones/records/delete?${params}`)
  logger.info('removeZoneRecord', {
    removeZoneRecordResponse,
  })
}

/**
 * Convenience method for removing multiple zone records
 */
async function removeZoneRecordMulti(zoneRecord: string, ipAddresses: string[]): Promise<void> {
  await Promise.all(ipAddresses.map((eachIpAddress) => removeZoneRecord(zoneRecord, eachIpAddress)))
}

/**
 * Custom validation/setup, specific for each dns provider
 */
async function validateDnsConf() {
  // Initialize token
  const token = await getSessionToken()
  // Let leader handle it to avoid race condition
  if (isLeader()) {
    // All our zone records are put into a specific zone in technitium dns server
    // Check and create target zone if not available
    let zoneData = await customFetch(
      `/api/zones/options/get?token=${token}&zone=${TECHNITIUM_CUSTOM_ZONE_NAME}&includeAvailableTsigKeyNames=true`
    ).catch(async (e) => {
      if (e?.errorMessage === 'No such authoritative zone was found: ops') {
        return null
      }
      throw e
    })
    if (!zoneData) {
      // Zone not available. Create it
      zoneData = await customFetch(`/api/zones/create?token=${token}&zone=${TECHNITIUM_CUSTOM_ZONE_NAME}&type=Primary`)
    }
    logger.info('validateDnsConf', {data: zoneData})
  }
}

const technitiumDnsManager: DnsManager = {
  resolvedAddresses,
  addZoneRecord,
  addZoneRecordMulti,
  removeZoneRecord,
  removeZoneRecordMulti,
  validateDnsConf,
}

export default technitiumDnsManager
