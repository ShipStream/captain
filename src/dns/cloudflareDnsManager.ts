import { DnsManager } from "./dnsManager.js"

function addZoneRecord(zoneRecord: string, address: string) {
  //TODO
}

function addZoneRecordMulti(zoneRecord: string, addresses: string []) {
  //TODO
}

function removeZoneRecord(zoneRecord: string, address: string) {
  //TODO
}

const cloudflareDnsManager: DnsManager = {
  addZoneRecord,
  addZoneRecordMulti,
  removeZoneRecord,
}

export default cloudflareDnsManager