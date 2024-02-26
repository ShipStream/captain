import {ReadableStream} from 'stream/web'
import {delay, http, passthrough, HttpResponse as mswHttpResponse, RequestHandlerOptions, RequestHandler} from 'msw'
import {SetupServer, setupServer as setupMswServer} from 'msw/node'
import appConfig from './../../src/appConfig.js'
import {NotificationService} from './../../src/NotificationService.js'
import { ConsulService } from './../../src/ConsulService.js'

function passingResponses(ipList: Array<string>) {
  return ipList.map((eachIp) => {
    return http.get(`http://${eachIp}/health`, async ({request, params, cookies}) => {
      return mswHttpResponse.json({status: 'ok'}, {status: 200})
    })
  })
}

function passingWithDelayResponses(ipList: Array<string>, delayInMs: number) {
  return ipList.map((eachIp) => {
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

// export function createFailByNetworkErrorResponses(ipList: Array<string>) {
//   return ipList.map((eachIp) => {
//     return http.get(`http://${eachIp}/health`, async ({request, params, cookies}) => {
//       await delay(1000)
//       return mswHttpResponse.json({status: 'failed'}, {status: 500})
//     })
//   })
// }

function mockLeaderShipTrueResponse() {
  return http.get(ConsulService.getConsulReadConfURL()!, async ({request, params, cookies}) => {
    return mswHttpResponse.json({
      Stats: {
        Config: {
          Datacenter: 'dc1',
          PrimaryDatacenter: 'dc1',
          NodeName: `consul-1`,
          Server: true,
        },
        consul: {
          leader: 'true',
        },
      },
    }, {status: 200});
  })
}

function mockLeaderShipFalseResponse() {
  return http.get(ConsulService.getConsulReadConfURL()!, async ({request, params, cookies}) => {
    return mswHttpResponse.json({
      Stats: {
        Config: {
          Datacenter: 'dc1',
          PrimaryDatacenter: 'dc1',
          NodeName: `consul-1`,
          Server: true,
        },
        consul: {
          leader: 'false',
        },
      },
    }, {status: 200});
  })
}


function mockLeaderShipConsulUnavailable() {
  return http.get(ConsulService.getConsulReadConfURL()!, async ({request, params, cookies}) => {
    // bypass so as to get 'ENOTFOUND'
    return passthrough()
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
        '10.5.0.21',
        '10.5.0.22',
        '10.5.0.23',
        '10.5.0.31',
        '10.5.0.32',
        '10.5.0.33',
        '10.5.0.34',
        '10.5.0.41',
        '10.5.0.42',
        '10.5.0.121',
        '10.5.0.161',
        '10.5.0.131',
        '10.5.0.171',
      ],
      1000
    ),
    // Passthrough and send all dns-server entries to technitium docker container
    http.all(`${appConfig.TECHNITIUM_BASE_URL}/*`, async ({request, params, cookies}) => {
      return passthrough()
    }),
    // Passthrough and send all socket requests as we have setup real sockets
    ...appConfig.MEMBER_URLS?.map((eachUrl: string) => eachUrl.replace('ws://', 'http://'))?.map(
      (eachCaptain: string) =>
        http.all(`${eachCaptain}/socket.io/`, async ({request, params, cookies}) => {
          return passthrough()
        })
    ),
    // mate connections are listened on a different port on the captain
    http.all(`${appConfig.SELF_URL.replace('ws://', 'http://').replace(appConfig.CAPTAIN_PORT, appConfig.MATE_PORT)}/socket.io/`, async ({request, params, cookies}) => {
      return passthrough()
    })    
  ]

  // slack service
  if (NotificationService.getSlackMessageUrl()) {
    requestHandlers.push(
      http.post(`${NotificationService.getSlackMessageUrl()}`, async ({request, params, cookies}) => {
        // slack returns ok: true in response
        return mswHttpResponse.json({ok: true}, {status: 200})
      })
    )
  }
  // datadog service
  if (NotificationService.getDatadogEventUrl()) {
    requestHandlers.push(
      http.post(`${NotificationService.getDatadogEventUrl()}`, async ({request, params, cookies}) => {
        // datadog returns status: 'ok' in response
        return mswHttpResponse.json({status: 'ok'}, {status: 200})
      })
    )
  }
  // generic http notification
  if (NotificationService.getGenericNotificationUrl()) {
    requestHandlers.push(
      http.post(NotificationService.getGenericNotificationUrl()!, async ({request, params, cookies}) => {
        const HTTP_HEADER_KEY = 'notify_token'
        const HTTP_HEADER_VALUE = 'dummy-sample-token-value'
        console.log('post-custom-message', {
          'req.headers?.[HTTP_HEADER_KEY]': request.headers.get(HTTP_HEADER_KEY),
          HTTP_HEADER_VALUE: HTTP_HEADER_VALUE,
        })
        if (request.headers.get(HTTP_HEADER_KEY) !== HTTP_HEADER_VALUE) {
          return mswHttpResponse.json({success: false, error: `${HTTP_HEADER_KEY} don't match`}, {status: 403})
        }
        return mswHttpResponse.json({success: false}, {status: 200})
      })
    )
  }
  if (ConsulService.getConsulReadConfURL()) {
    requestHandlers.push(mockLeaderShipTrueResponse());  
  }
  mswServer = setupMswServer(...requestHandlers)
}

const requestMockTest = {
  getMswServer,
  setupMswReqMocks,
  passingResponses,
  passingWithDelayResponses,
  failByNetworkErrorResponses,
  mockLeaderShipTrueResponse,
  mockLeaderShipFalseResponse,
  mockLeaderShipConsulUnavailable,
}

export default requestMockTest
