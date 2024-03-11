

export const config ={
    mediasoup:{
        worker:{
            rtcMinPort:10000,
            rtcMaxPort:59999,
            logLevel:'debug',
            logTags:[
                'info',
                'ice',
                'dtls',
                'srtp',
            ] 
        },
        router:{
            mediaCodecs:[
                {
                    kind:'audio',
                    mimeType:'audio/opus',
                    clockRate: 48000,
                    channels: 2
                },
                {
                    kind:'video',
                    mimeType:'video/VP8',
                    clockRate: 90000,
                    parameters:{
                        'x-google-start-bitrate':1000,
                    }
                }
            ]
        },
        webRtcTransport:{
            listenIps:[
                {
                    ip:'0.0.0.0',
                    announcedIp:'127.0.0.1'
                }
            ],
            maxIncomeBitrate: 3500000,
            initialAvailableOutgoingBitrate: 6000000
        }  
    }
}