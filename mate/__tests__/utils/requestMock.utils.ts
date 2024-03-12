import {ReadableStream} from 'stream/web'
import {delay, http, passthrough, HttpResponse as mswHttpResponse, RequestHandler} from 'msw'
import {SetupServer, setupServer as setupMswServer} from 'msw/node'
import appConfig from '../../src/appConfig.js'

function passingResponses(ipList: Array<string>) {
  return ipList.map((eachIp) => {
    return http.get(`http://${eachIp}/health`, async ({request, params, cookies}) => {
      return mswHttpResponse.json({status: 'ok'}, {status: 200})
    })
  })
}

function passingWithDelayResponses(ipList: Array<string>, delayInMs: number) {
  console.log('passingWithDelayResponses', ipList)
  return ipList.map((eachIp) => {
    console.log('passingWithDelayResponses:eachIp', eachIp)
    return http.get(`http://${eachIp}/health`, async ({request, params, cookies}) => {
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(JSON.stringify({message: 'Is healthy'}))
          controller.enqueue(JSON.stringify({status: 200}))
          await delay(Math.floor(delayInMs))
          controller.close()
        },
      })
      return new mswHttpResponse(stream, {
        headers: {
          'Content-Type': 'text/html',
          'Transfer-Encoding': 'chunked',
        },
      })
    })
  })
}

function failByNetworkErrorResponses(ipList: Array<string>) {
  return ipList.map((eachIp) => {
    return http.get(`http://${eachIp}/health`, async ({request, params, cookies}) => {
      await delay(1000)
      return mswHttpResponse.error()
    })
  })
}

let mswServer: SetupServer

function getMswServer() {
  return mswServer!
}

function setupMswReqMocks() {
  // global.console = console
  // Use onUnhandledRequest: 'error' and list all possible urls even if it requires 'passthrough',
  // so as to make sure we don't miss anything
  const requestHandlers: RequestHandler[] = [
    ...passingWithDelayResponses(
      [
        //mate-1 forum-app private ips',
        '10.5.0.122',
        '10.5.0.123',
        '10.5.0.124',
        '10.5.0.125',
        '10.5.0.126',
        '10.5.0.127',
        '10.5.0.128',
        '10.5.0.129',
        //mate-2 forum-app private ips',
        '10.5.0.162',
        '10.5.0.163',
        '10.5.0.164',
        '10.5.0.165',
        '10.5.0.166',
        '10.5.0.167',
        '10.5.0.168',
        '10.5.0.169',
        //mate-1 blog-app private ips',
        '10.5.0.132',
        '10.5.0.133',
        '10.5.0.134',
        '10.5.0.135',
        '10.5.0.136',
        '10.5.0.137',
        '10.5.0.138',
        '10.5.0.139',
        //mate-2 blog-app private ips',
        '10.5.0.172',
        '10.5.0.173',
        '10.5.0.174',
        '10.5.0.175',
        '10.5.0.176',
        '10.5.0.177',
        '10.5.0.178',
        '10.5.0.179',
      ],
      1000
    ),
    // Passthrough and send all socket requests as we have setup real sockets
    ...appConfig.CAPTAIN_URL?.map((eachUrl: string) => eachUrl.replace('ws://', 'http://'))?.map(
      (eachCaptain: string) =>
        http.all(`${eachCaptain}/socket.io/`, async ({request, params, cookies}) => {
          return passthrough()
        })
    ),
  ]

  mswServer = setupMswServer(...requestHandlers)
}

const requestMockTest = {
  getMswServer,
  setupMswReqMocks,
  passingResponses,
  passingWithDelayResponses,
  failByNetworkErrorResponses,
}

export default requestMockTest
