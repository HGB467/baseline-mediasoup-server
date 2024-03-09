import mediasoup from 'mediasoup'
import { config } from './config.js'

export const createWorker = async()=>{
  const worker = await mediasoup.createWorker({
    logLevel:config.mediasoup.worker.logLevel,
    logTags:config.mediasoup.worker.logTags,
    rtcMinPort:config.mediasoup.worker.rtcMinPort,
    rtcMaxPort:config.mediasoup.worker.rtcMaxPort
  })

  worker.on('died',()=>{
    console.error("Mediasoup Stopped Working, exiting in 2s",worker.pid)
    setTimeout(()=>{
     process.exit(1)
    },2000)
  })

  const mediaCodecs = config.mediasoup.router.mediaCodecs
  const router = await worker.createRouter({mediaCodecs})

  return router;
}
