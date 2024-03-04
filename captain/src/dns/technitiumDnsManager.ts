import {logger, customFetch, RETRY_OPTIONS, initRetryOptions, incrementCountAndWaitBeforeRetry, MAX_ALLOWED_RETRIES} from './../coreUtils.js'
import appState from './../appState.js'
import appConfig from './../appConfig.js'
import {DnsManager} from './dnsManager.js'

export const ERROR_DNS_ZONE_NOT_INITIALIZED_PREFIX = `No such authoritative zone was found:`
export const ERROR_DNS_ZONE_ALREADY_EXISTS = `Zone already exists:`

/**
 * Common handler for typical response from technitium
 */
async function fetchData(url: string, init?: RequestInit, includeSessionToken: boolean = true, retryOptions: RETRY_OPTIONS = {} as any) {
  if (!appConfig.TECHNITIUM_BASE_URL) {
    throw new Error('TECHNITIUM_BASE_URL needs to be set')
  }
  const logID = `Technitium Dns Server:${url}`
  let fullUrl = `${appConfig.TECHNITIUM_BASE_URL}${url}`
  if (includeSessionToken) {
    const urlObject = new URL(fullUrl)
    // Update the 'token' with new session    
    urlObject.searchParams.set('token', await getSessionToken())
    fullUrl = urlObject.toString()
  }
  retryOptions = initRetryOptions(retryOptions)  
  const jsonResponse: any = await customFetch(logID, fullUrl, init)
  if (jsonResponse.status === 'ok') {
    return jsonResponse
  } else {
    logger.debug(logID, 'status:not:ok:', jsonResponse)
    // check for session expiry
    if (jsonResponse?.status === 'invalid-token' && jsonResponse?.errorMessage === 'Invalid token or session expired.') {
      // wait and retry session expiry
      if (retryOptions.currentRetryAttempt < MAX_ALLOWED_RETRIES) {
        clearSessionToken()
        await incrementCountAndWaitBeforeRetry(logID, retryOptions, {
          url: fullUrl,
          reason: 'Session Expired',
          error:  jsonResponse?.errorMessage | jsonResponse,
        })
        return fetchData(url, init, includeSessionToken, retryOptions)
      }
    }
    throw new Error(`${logID}:Received failed response: Details: ${JSON.stringify(jsonResponse, undefined, 2)}`, {cause: jsonResponse})
  }
}

let sessionToken: string

/**
 * Clear session so it can be renewed, next time
 *
 */
function clearSessionToken() {
  sessionToken = undefined as any
}

/**
 * Get/Cache session token
 */
async function getSessionToken() {
  if (sessionToken) {
    return sessionToken
  } else {
    const response = await fetchData('/api/user/login?user=admin&pass=admin&includeInfo=true', undefined, false)
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
  const params = new URLSearchParams({
    zone: appConfig.TECHNITIUM_CUSTOM_ZONE_NAME,
    domain: zoneRecord,
  }).toString()
  // logger.info('resolvedAddresses', params)
  const resolvedAddressesResponse = await fetchData(`/api/zones/records/get?${params}`)
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
  const params = new URLSearchParams({
    zone: appConfig.TECHNITIUM_CUSTOM_ZONE_NAME,
    domain: zoneRecord,
    ipAddress: ipAddress,
    type: 'A',
    ttl: '60',
  }).toString()
  // logger.info('addZoneRecord', params)
  const addZoneRecordResponse = await fetchData(`/api/zones/records/add?${params}`)
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
  const params = new URLSearchParams({
    zone: appConfig.TECHNITIUM_CUSTOM_ZONE_NAME,
    domain: zoneRecord,
    ipAddress: ipAddress,
    type: 'A',
  }).toString()
  // logger.info('removeZoneRecord', params)
  const removeZoneRecordResponse = await fetchData(`/api/zones/records/delete?${params}`)
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
  // Let leader handle it to avoid race condition
  if (!appState.isLeader()) {
    logger.warn('createZoneIfNotAvailable called from non-leader')
  }
  await createZoneIfNotAvailable()
}

export async function createZoneIfNotAvailable() {
    // All our zone records are put into a specific zone in technitium dns server
    // Check and create target zone if not available
    let zoneData = await fetchData(
      `/api/zones/options/get?zone=${appConfig.TECHNITIUM_CUSTOM_ZONE_NAME}&includeAvailableTsigKeyNames=true`
    ).catch(async (e) => {
      logger.debug('createZoneIfNotAvailable:fetch:catch', e)
      if (`${e?.cause?.errorMessage}`.startsWith(ERROR_DNS_ZONE_NOT_INITIALIZED_PREFIX)) {
        logger.info('Error: Technitium Dns Server:createZoneIfNotAvailable:', e?.cause?.errorMessage)
        return null
      }
      throw e
    })
    if (!zoneData) {
      // Zone not available. Create it
      zoneData = await fetchData(`/api/zones/create?zone=${appConfig.TECHNITIUM_CUSTOM_ZONE_NAME}&type=Primary`).catch(async (e) => {
        logger.debug('createZoneIfNotAvailable:create:catch', e)
        if (`${e?.cause?.errorMessage}`.startsWith(ERROR_DNS_ZONE_ALREADY_EXISTS)) {
          logger.info('Error: Technitium Dns Server:createZoneIfNotAvailable:', e?.cause?.errorMessage)
          return null
        }
        throw e
      })
    }
    logger.debug('createZoneIfNotAvailable', {data: zoneData})
}

/* Primarily for testing and development */
export async function deleteZoneWithAllEntries() {
  const params = new URLSearchParams({
    zone: appConfig.TECHNITIUM_CUSTOM_ZONE_NAME,
  }).toString()
  // logger.info('removeZoneRecord', params)
  const deleteZoneWithAllEntriesResponse = await fetchData(`/api/zones/delete?${params}`).catch(async (e) => {
    logger.debug('deleteZoneWithAllEntries:catch', e)
    if (`${e?.cause?.errorMessage}`.startsWith(ERROR_DNS_ZONE_NOT_INITIALIZED_PREFIX)) {
      logger.info('Error: Technitium Dns Server:deleteZoneWithAllEntries:', e?.cause?.errorMessage)
      return null
    }
    throw e
  })
  logger.info('deleteZoneWithAllEntries', {
    deleteZoneWithAllEntriesResponse,
  })  
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
