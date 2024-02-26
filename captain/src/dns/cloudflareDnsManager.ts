/* eslint-disable @typescript-eslint/no-unused-vars */
import appConfig from './../appConfig.js'
import {MAX_ALLOWED_RETRIES, isNetworkError, logger} from './../coreUtils.js'
import appState from './../appState.js'
import {DnsManager} from './dnsManager.js'
import {CustomError} from './../CustomError.js'

function isJson(jsonString: string) {
  try {
    JSON.parse(jsonString)
  } catch (e) {
    return false
  }
  return true
}

export const CLOUDFLARE_BASE_URL = `https://api.cloudflare.com/client/v4/zones`
export const CLOUDFLARE_ZONE_RECORDS_PER_PAGE = 10
/**
 * Wrapper over node 'fetch' customized for typical response from cloudflare
 */
async function customFetch(
  url: string,
  fetchParams?: RequestInit,
  retryOptions: {currentRetryAttempt: number; maxAllowedRetries: number} = {} as any
) {
  const CLOUDFLARE_BASE_ZONE_URL = `${CLOUDFLARE_BASE_URL}/${appConfig.CLOUDFLARE_ZONE_ID}`  
  const fullUrl = `${CLOUDFLARE_BASE_ZONE_URL}${url}`
  const logID = `cloudflareDnsManager:customFetch: ${fullUrl}`
  retryOptions = Object.assign(retryOptions || {}, {
    currentRetryAttempt: retryOptions?.currentRetryAttempt ?? 0,
    maxAllowedRetries: retryOptions?.maxAllowedRetries ?? MAX_ALLOWED_RETRIES,
  })
  try {
    const token = appConfig.CLOUDFLARE_TOKEN
    const response = await fetch(fullUrl, {
      ...fetchParams,
      headers: {
        ...fetchParams?.headers,
        Authorization: `Bearer ${token}`,
      },
    })
    logger.debug(logID, await response.clone().text())
    if (response.ok) {
      const jsonResponse: any = await response.json()
      if (jsonResponse.success === true) {
        return jsonResponse
      } else {
        const errorMessages = jsonResponse.errors?.map((eachError: any) => eachError.message)
        throw new CustomError(`Error with dns server: ${errorMessages}`, {
          url: `${url}`,
          fetchParams,
          response: jsonResponse,
          errors: errorMessages,
        })
      }
    } else {
      const responseText = await response.text()
      let errorMessages
      if (isJson(responseText)) {
        const jsonResponse = JSON.parse(responseText)
        errorMessages = jsonResponse?.error || jsonResponse?.errors?.map((eachError: any) => eachError.message)
      } else {
        errorMessages = [responseText]
      }
      if (!errorMessages) {
        errorMessages = responseText || response.statusText || 'Unknown Error'
      }
      throw new CustomError(`Error with dns server: ${errorMessages}`, {
        url: `${url}`,
        fetchParams,
        response: responseText,
        errors: errorMessages,
      })
    }
  } catch (e: any) {
    if (isNetworkError(e)) {
      // wait and retry network errors
      if (retryOptions.currentRetryAttempt < MAX_ALLOWED_RETRIES) {
        retryOptions.currentRetryAttempt += 1
        const waitTime = 5000 + 1500 * retryOptions.currentRetryAttempt
        logger.warn(`${logID}: currentRetryAttempt`, {
          attempt: retryOptions.currentRetryAttempt,
          reason: e?.cause?.code,
          waitTime,
        })
        await new Promise((resolve) => setTimeout(resolve, waitTime))
        return customFetch(url, fetchParams, retryOptions)
      }
    }
    throw e
  }
}

async function getAllPagesOfDnsRecords(filterCriteria: any) {
  let currentPage = 0
  const result = []
  let eachPageResult
  do {
    currentPage++
    const searchParams = new URLSearchParams({
      per_page: `${CLOUDFLARE_ZONE_RECORDS_PER_PAGE}`,
      page: currentPage,
      ...filterCriteria,
    }).toString()
    eachPageResult = await customFetch(`/dns_records?${searchParams}`, {
      method: 'get',
      headers: {
        'Content-Type': 'application/json',
      },
    })
    result.push(...eachPageResult.result)
  } while (currentPage < eachPageResult?.result_info?.total_pages)
  return result
}

/**
 * Live dns query to get all resolved ip's for a given zone record
 */
async function resolvedAddresses(zoneRecord: string): Promise<string[]> {
  logger.info('resolvedAddresses:1', {zoneRecord})
  const resolvedAddressesResponse = await getAllPagesOfDnsRecords({
    name: zoneRecord,
    type: 'A',
  })
  logger.debug('resolvedAddresses:2', {resolvedAddressesResponse})
  const result = resolvedAddressesResponse
    ?.map((eachRecord: any) => {
      return eachRecord.content
    })
    .filter((eachIPAddress: string) => !!eachIPAddress)
  logger.info('resolvedAddresses:3', {
    result,
  })
  return result
}

/**
 * Add new zone record
 */
async function addZoneRecord(zoneRecordName: string, ipAddress: string) {
  logger.info(`Received add zone record request`, {zoneRecordName, ipAddress})
  if (!`${zoneRecordName}`.endsWith(await getDomainName())) {
    // This helps avoid any auto conversion and programmatic/api errors.
    // For example if we use 'helpdesk.example.cm' by mistake instead of 'helpdesk.example.com', it will auto convert to 'helpdesk.example.cm.example.com' and leads to errors
    throw new Error(
      `zone_record: ${zoneRecordName} doesn't end with the domain name: ${await getDomainName()}. 'zone_record' of service needs to fully qualified and shouldn't be a prefix.`
    )
  }
  const data = {
    name: zoneRecordName,
    content: ipAddress,
    type: 'A',
    ttl: 60,
  }
  const addZoneRecordResponse = await customFetch('/dns_records', {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })
  const createdZoneRecordName = addZoneRecordResponse?.result?.name
  if (!createdZoneRecordName) {
    throw new Error(`Error creating dns entry: ${zoneRecordName}`)
  }
  if (zoneRecordName !== createdZoneRecordName) {
    throw new Error(
      `'zone_record' of service needs to fully qualified and shouldn't be a prefix: ${zoneRecordName} !== ${createdZoneRecordName}`
    )
  }
  logger.debug('addZoneRecord:addZoneRecordResponse', addZoneRecordResponse)
}

/**
 * Convenience method for multiple new zone records
 */
async function addZoneRecordMulti(zoneRecord: string, ipAddresses: string[]) {
  logger.info(`Received add zone record 'multi' request`, {zoneRecord, addresses: ipAddresses})
  await Promise.all(ipAddresses.map((eachIpAddress) => addZoneRecord(zoneRecord, eachIpAddress)))
}

/**
 * Remove zone record
 */
async function removeZoneRecord(zoneRecord: string, ipAddress: string) {
  logger.info(`Received remove zone record request`, {zoneRecord, address: ipAddress})
  if (!`${zoneRecord}`.endsWith(await getDomainName())) {
    // This helps avoid any auto conversion and programmatic/api errors.
    // For example if we use 'helpdesk.example.cm' by mistake instead of 'helpdesk.example.com', it will auto convert to 'helpdesk.example.cm.example.com' and leads to errors
    throw new Error(
      `zone_record: ${zoneRecord} doesn't end with the domain name: ${await getDomainName()}. 'zone_record' of service needs to fully qualified and shouldn't be a prefix.`
    )
  }
  const resolvedAddressesResponse = await getAllPagesOfDnsRecords({
    name: zoneRecord,
    type: 'A',
    content: ipAddress,
  })
  const result = resolvedAddressesResponse?.filter((eachRecord: any) => {
    return !!eachRecord.content
  })
  const existingRecord = result?.[0]
  logger.debug('removeZoneRecord:existingRecord', existingRecord)
  if (existingRecord) {
    const removeZoneRecordResponse = await customFetch(`/dns_records/${existingRecord.id}`, {method: 'delete'})
    logger.debug('removeZoneRecord:removeZoneRecordResponse', {
      removeZoneRecordResponse,
    })
  }
}

/**
 * Convenience method for removing multiple zone records
 */
async function removeZoneRecordMulti(zoneRecord: string, ipAddresses: string[]): Promise<void> {
  logger.info(`Received remove zone record 'multi' request`, {zoneRecord, ipAddresses})
  await Promise.all(ipAddresses.map((eachIpAddress) => removeZoneRecord(zoneRecord, eachIpAddress)))
}

let zoneDetails: any = undefined

async function resetCache() {
  zoneDetails = undefined
}

async function getZoneDetails() {
  if (!zoneDetails) {
    zoneDetails = await customFetch('', {
      method: 'get',
      headers: {
        'Content-Type': 'application/json',
      },
    })
  }
  return zoneDetails
}

async function getDomainName() {
  return zoneDetails?.result?.name;
}

/**
 * Custom validation/setup, specific for each dns provider
 */
async function validateDnsConf() {
  if (!appState.isLeader()) {
    logger.warn('Dns initialized on non-leader.')
  }
  // reset cache to enable live refetch of zone data
  resetCache()
  // fetch zone details to test connection and auth
  const latestZoneData = await getZoneDetails()
  logger.debug('validateDnsConf', {zoneData: latestZoneData?.result})
}

const cloudflareDnsManager: DnsManager = {
  resolvedAddresses,
  addZoneRecord,
  addZoneRecordMulti,
  removeZoneRecord,
  removeZoneRecordMulti,
  validateDnsConf,
}

export default cloudflareDnsManager
