/* eslint-disable @typescript-eslint/no-unused-vars */
import appConfig from './../appConfig.js'
import {logger} from './../coreUtils.js'
import {isLeader} from './../appState.js'
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

/**
 * Wrapper over node 'fetch' customized for typical response from cloudflare
 */
async function customFetch(url: NodeJS.fetch.RequestInfo, fetchParams?: RequestInit) {
  const CLOUDFLARE_BASE_URL = `https://api.cloudflare.com/client/v4/zones/${appConfig.CLOUDFLARE_ZONE_ID}`
  const token = appConfig.CLOUDFLARE_TOKEN
  const response = await fetch(`${CLOUDFLARE_BASE_URL}${url}`, {
    ...fetchParams,
    headers: {
      ...fetchParams?.headers,
      Authorization: `Bearer ${token}`,
    },
  })
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
}

async function getAllPagesOfDnsRecords(filterCriteria: any) {
  const PER_PAGE = 10
  let currentPage = 0
  const result = []
  let eachPageResult
  do {
    currentPage++
    const searchParams = new URLSearchParams({
      per_page: `${PER_PAGE}`,
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
  const resolvedAddressesResponse = await getAllPagesOfDnsRecords({
    name: zoneRecord,
    type: 'A',
  })
  const result = resolvedAddressesResponse
    ?.map((eachRecord: any) => {
      return eachRecord.content
    })
    .filter((eachIPAddress: string) => !!eachIPAddress)
  logger.info('resolvedAddresses', {
    result,
  })
  return result
}

/**
 * Add new zone record
 */
async function addZoneRecord(zoneRecordName: string, ipAddress: string) {
  logger.info(`Received add zone record request`, {zoneRecordName, ipAddress})
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
  logger.info('addZoneRecord:addZoneRecordResponse', addZoneRecordResponse)
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
  const resolvedAddressesResponse = await getAllPagesOfDnsRecords({
    name: zoneRecord,
    type: 'A',
    content: ipAddress,
  })
  const result = resolvedAddressesResponse?.filter((eachRecord: any) => {
    return !!eachRecord.content
  })
  const existingRecord = result?.[0]
  logger.info('removeZoneRecord:existingRecord', existingRecord)
  if (existingRecord) {
    const removeZoneRecordResponse = await customFetch(`/dns_records/${existingRecord.id}`, {method: 'delete'})
    logger.info('removeZoneRecord:removeZoneRecordResponse', {
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

/**
 * Custom validation/setup, specific for each dns provider
 */
async function validateDnsConf() {
  if (isLeader()) {
    // fetch zone details to test connection and auth
    const zoneDetails = await customFetch('', {
      method: 'get',
      headers: {
        'Content-Type': 'application/json',
      },
    })
    logger.info('validateDnsConf', {zoneDetails: zoneDetails?.result})
  }
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
