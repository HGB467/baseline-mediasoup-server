import { createServer } from 'http'
import { Server } from 'socket.io'
import { cpus } from 'os'
import { createWorker } from './worker.js'
import { createNewTransport } from './transport.js'
import { ConsumeProcessorQueue } from './ConsumeProcessorQueue.js'


const server = createServer()
const io = new Server(server,{
    cors:{
        origin:'*'
    }
})

let Users = []
let producerTransports = new Map()
let consumerTransports = new Map()
let producerCores;
let consumerCores;
let consumerRouters=[];
let membersinConsumerRouters=[]
let producerRouters=[]
let membersinProducerRouters=[]
let audioLevelObservers = []
let producersLimit = 300;
let consumersLimit = 300;
let pipedProducers = []
let producers = []
let producerObjects = new Map()
let consumers = new Map()
let audioLevelObserverUsers = new Map()
let consumerObjects = new Map()

const queue = new ConsumeProcessorQueue()

io.on("connection",(socket)=>{
socket.on('addUserCall',(user)=>{
  addUserCall(user,socket)
 })

 socket.on('getRTPCapabilites',(callback)=>{
  callback(
    { capabilities: producerRouters[0]?.rtpCapabilities }
  )
 })

 socket.on('createTransport',(id)=>{
   createTransport(socket,id)
 })

 socket.on('connectTransport',({dtlsParameters,id})=>{
   connectTransport(dtlsParameters,socket,id)
 })

 socket.on('produce',(data)=>{
   produce(data,socket)
 })


 socket.on("createConsumeTransport",(data,callback)=>{
  queue.addItemToProcess(data,socket,callback)
})

socket.on('transportConnect',(data)=>{
 connectConsumerTransport(data,socket)
})

socket.on('startConsuming',(data)=>{
  startConsuming(data,socket)
})

 socket.on('closeScreenShare',async(producerIds,callback)=>{
  for(let i=0;i<producerIds.length;i++){
    const producer = producerObjects.get(producerIds[i])
    await producer?.close()
    producerObjects.delete(producerIds[i])
    const producersFilter = producers?.filter((producer)=>producer?.producerId!==producerIds[i])
    producers = producersFilter;
    const filterPipedProducers = pipedProducers?.filter((pipedProducer)=>pipedProducer?.producerId!==producerIds[i])
    pipedProducers = filterPipedProducers;
  }
 callback({
  status:'OK'
 })
 
 })

 socket.on('handleProducer',async({producerId,state},callback)=>{
  // const producer = producerObjects.get(producerId)

  // if(state){
  //   await producer?.pause()
  // }
  // else{
  //   await producer?.resume()
  // }

 callback({
  status:'OK'
 })
 
 })

 socket.on('resumeConsumer',async(consumerId)=>{
  try{
    const consumer = consumerObjects.get(consumerId)
    await consumer?.resume()
  }
  catch(err){
    console.log(err)
  }
 })

 socket.on('chat',({roomId,message})=>{
  socket.broadcast.to(roomId).emit('chat',message)
 })

socket.on('producerRestartIce', async (callback) => {
  const transport = producerTransports.get(socket.id)?.transport;
  const iceparams = await transport?.restartIce();
  callback(iceparams)
})

socket.on("consumerRestartIce", async (storageId, callback) => {
  const transport = consumerTransports.get(storageId)?.transport;
  const iceparams = await transport?.restartIce();
  callback(iceparams);
});

socket.on("closeProducer", async (producerId, callback) => {
  const producer = producerObjects.get(producerId);
  if(!producer) return;
  await producer?.close();
  producerObjects.delete(producerId);
  const producersFilter = producers?.filter(
    (producer) => producer?.producerId !== producerId,
  );
  producers = producersFilter;
  const filterPipedProducers = pipedProducers?.filter(
    (pipedProducer) => pipedProducer?.producerId !== producerId,
  );
  pipedProducers = filterPipedProducers;
  callback({
    status: "OK",
  });
});


socket.on('disconnect',()=>{
  handleDisconnect(socket.id)
})

})


function assignCores() {
  let cpuCores = cpus().length;
  if (cpuCores === 2) {
    producerCores = 1;
    consumerCores = 1;
  }
  else {
    producerCores = Math.floor(cpuCores / 4);
    consumerCores = Math.floor(cpuCores - producerCores);
  }
}

async function createAudioLevelObserver(router,i){
 audioLevelObservers[i] = await router?.createAudioLevelObserver(
        {
          maxEntries: 1,
          threshold: -50,
          interval: 600
        });
  audioLevelObservers[i]?.on('volumes',(volumes)=>{
    volumes?.forEach((volume)=>{
    const producerSpeaking = volume?.producer?.id;
    const sockId = producers.find((producer)=>producer?.producerId===producerSpeaking)?.socketId;
    if(sockId){
      io.to(sockId).emit('speaking',true)
    }
    })
  })
}

async function startMediasoup(){
    try{
      assignCores()
      for (let i = 0; i < producerCores; i++) {
        const router = await createWorker()
        producerRouters.push(router)
        membersinProducerRouters.push(0)
        await createAudioLevelObserver(router,i)
      }

      for (let i = 0; i < consumerCores; i++) {
        const router = await createWorker()
        consumerRouters.push(router)
        membersinConsumerRouters.push(0)
      }
    }
    catch(err){
        throw err;
    }
}

startMediasoup();

function addUserCall(user,socket){
  Users.push({...user,socketId:socket.id})
  socket.join(user?.room)
  const filteredProducers = producers.filter((producer)=>producer?.room===user?.room)
  socket.emit('currentProducers',filteredProducers)
}

function getProducerRouter() {
  let routerToReturnIdx=null;
  let breakLoop = false;
  let minimumMembers=0;
  let minimumMembersIdx=0;
  membersinProducerRouters.forEach((item, idx) => {
    if (breakLoop) return;
    if(minimumMembers===0){
     minimumMembers = item;
     minimumMembersIdx = idx;
    }
    else if(item<minimumMembers){
      minimumMembers = item;
      minimumMembersIdx = idx;
    }
    if (item < producersLimit) {
      breakLoop = true
      routerToReturnIdx = idx;
    }
    if(routerToReturnIdx===null && idx===(membersinProducerRouters.length-1)){
     routerToReturnIdx = minimumMembersIdx;
    }
  })
  return routerToReturnIdx;
}



async function createTransport(socket,id){
    try{
      let routerToUseIdx = getProducerRouter()
      const {transport,params} = await createNewTransport(producerRouters[routerToUseIdx])
       producerTransports.set(socket.id, { transport: transport, router: routerToUseIdx })
       membersinProducerRouters[routerToUseIdx] +=1;
       io.to(id).emit('transportCreated',{data:params})

    }
    catch(err){
       console.log(err)
    }
}

async function connectTransport(params,socket,id){
  try{
    const ProducerTransport = producerTransports.get(id)?.transport;
    await ProducerTransport.connect({dtlsParameters:params})
    io.to(id).emit('transportConnected')
  }
  catch(err){
    console.log(err)
  }
}



async function produce(data,socket){
    try{
        const {kind,rtpParameters,id,room} = data;
        const ProducerRouter = producerTransports.get(id)?.router;
        const ProducerTransport = producerTransports.get(id)?.transport;
        let Producer;
        if(kind==='video'){
          if(data?.appData?.type==='screen'){
            Producer = await ProducerTransport.produce({kind,rtpParameters})
            producerObjects.set(Producer?.id,Producer)
             io.to(id).emit('producing',{producerId:Producer.id,kind:kind,screenShare:true})

          }
          else{
            Producer = await ProducerTransport.produce({kind,rtpParameters})
            producerObjects.set(Producer?.id,Producer)
           io.to(id).emit('producing',{producerId:Producer.id,kind:kind,screenShare:false})

          }
        }
        else{
          if(data?.appData?.type==='screen'){
            Producer = await ProducerTransport.produce({kind,rtpParameters,appData:data?.appData})
            producerObjects.set(Producer?.id,Producer)
             io.to(id).emit('producing',{producerId:Producer.id,kind:kind,screenShare:true})

          }
          else{
            Producer = await ProducerTransport.produce({kind,rtpParameters})
            producerObjects.set(Producer?.id,Producer)
            await audioLevelObservers[ProducerRouter]?.addProducer( { producerId: Producer?.id} )
            audioLevelObserverUsers.set(socket?.id,{router:ProducerRouter,producerId:Producer?.id})
           io.to(id).emit('producing',{producerId:Producer.id,kind:kind,screenShare:false})

          }
        }
        producers.push({producerId:Producer.id,socketId:socket.id,room:room,kind:kind,screenShare:data?.appData?.type==='screen'?true:false})
        socket?.broadcast?.to(room)?.emit('newProducer',{producerId:Producer.id,socketId:socket.id,screenShare:data?.appData?.type==='screen'?true:false})
        }
    catch(err){
        console.log(err)
    }

}


export async function createConsumeTransport(data,socket,callback){
  let storageId;
  let param;
    try{
        const routerIdx = getConsumerRouter();
        storageId = `${socket.id}-${routerIdx}`
        if(consumerTransports.has(storageId)){
            const transport = consumerTransports.get(storageId)?.transport;
            param = {
                id:transport.id,
                iceParameters:transport.iceParameters,
                iceCandidates:transport.iceCandidates,
                dtlsParameters:transport.dtlsParameters,
                sctpParameters:transport.sctpParameters
            }
            membersinConsumerRouters[routerIdx] +=1;
        }
        else{
            const {transport,params} = await createNewTransport(consumerRouters[routerIdx])
            param = params;
            consumerTransports.set(storageId,{transport:transport,router:routerIdx})
            membersinConsumerRouters[routerIdx] +=1;
            if(consumers.has(socket.id)){
              consumers.set(socket.id,[...consumers.get(socket.id),storageId])
            }
            else{
              consumers.set(socket.id,[storageId])
            }
        }
        await pipeProducer(data,routerIdx)
        callback({data:param,storageId:storageId,...data})
      
    }
    catch(err){
        if(err?.toString()==='Error: a Producer with same producerId already exists [method:transport.produce]' || `TypeError: a Producer with same id "${data?.producerId}" already exists`){
          callback({data:param,storageId:storageId,...data})
          return;
        }
        console.log(err)
        // if(consumerTransports.has(storageId)){
        //   const item = consumerTransports.get(storageId);
        //   const router = item?.router;
        //   membersinConsumerRouters[router] -=1;
        //   const transport = item?.transport;
        //   await transport?.close()
        //   consumerTransports.delete(storageId)
        //  const mapItem = consumers.get(socket.id)
        //  const filterArr = mapItem.filter((item)=>item!==storageId)
        //  consumers.set(socket.id,filterArr)

        // }
    }
}

async function pipeProducer(data,routerIdx){
    const originalRouterIdx = producerTransports.get(data.socketId)?.router;
    const filterPipedProducer = pipedProducers.find((producer) => producer?.producerId === data?.producerId)
    if (filterPipedProducer && Object.keys(filterPipedProducer).length!==0) {
      const checkSameRouter = filterPipedProducer?.pipedRouters?.some((router)=>router.idx===routerIdx)
      if (!checkSameRouter) {
        let idxToUse = filterPipedProducer?.pipedRouters[filterPipedProducer?.pipedRouters?.length-1]?.idx;
        await consumerRouters[idxToUse]?.pipeToRouter({ producerId: data?.producerId, router: consumerRouters[routerIdx] });
        const arrIndex = pipedProducers?.findIndex((item)=>item?.producerId===data?.producerId)
        pipedProducers[arrIndex].pipedRouters = [...filterPipedProducer?.pipedRouters,{type:'consumer',idx:routerIdx}]
        pipedProducers[arrIndex].originalRouters = [...filterPipedProducer?.originalRouters,{type:'consumer',idx:idxToUse}]
      }
    }
    else {
      await producerRouters[originalRouterIdx]?.pipeToRouter({ producerId: data?.producerId, router: consumerRouters[routerIdx] });
      pipedProducers.push({ pipedRouters: [{type:'consumer',idx:routerIdx}], socketId: data?.socketId, producerId: data?.producerId,originalRouters: [{type:'producer',idx:originalRouterIdx}] })
    }
}

function getConsumerRouter() {
  let routerToReturnIdx=null;
  let breakLoop = false;
  let minimumMembers=0;
  let minimumMembersIdx=0;
  membersinConsumerRouters.forEach((item, idx) => {
    if (breakLoop) return;
    if(minimumMembers===0){
     minimumMembers = item;
     minimumMembersIdx = idx;
    }
    else if(item<minimumMembers){
      minimumMembers = item;
      minimumMembersIdx = idx;
    }
    if (item < consumersLimit) {
      breakLoop = true
      routerToReturnIdx = idx;
    }
    if(routerToReturnIdx===null && idx===(membersinConsumerRouters.length-1)){
     routerToReturnIdx = minimumMembersIdx;
    }
  })
  return routerToReturnIdx;
}



async function connectConsumerTransport(data,socket){
  try{
    const consumeTrans = consumerTransports.get(data?.storageId)?.transport;
    await consumeTrans.connect({dtlsParameters:data.dtlsParameters})
    io.to(socket.id).emit('consumerTransportConnected',data?.storageId)
  }
  catch(err){
    console.log(err)
  }
}

async function startConsuming(data,socket){
    try{
         const consumeTrans = consumerTransports.get(data?.storageId)?.transport;
         const consumer = await consumeTrans.consume({
            producerId:data?.producerId,
            rtpCapabilities:data.rtpCapabilities,
            paused:data?.paused
        })

        consumerObjects.set(consumer?.id,consumer)

        const userDetails = Users.find((user)=>user?.socketId===data?.socketId)

        const producer = producerObjects.get(data?.producerId)

        io.to(socket.id).emit('consumerCreated',{
          producerId:data.producerId,
          kind:consumer.kind,
          id:consumer.id,
          rtpParameters:consumer.rtpParameters,
          storageId:data?.storageId,
          socketId:data?.socketId,
          paused:consumer?.paused,
          screenShare:data?.screenShare,
          userDetails:userDetails,
          muted:producer?.paused
        })

          consumer.on('producerpause',async()=>{
          io.to(socket?.id).emit('producerPaused',{
            storageId:data?.storageId,
            socketId:data?.socketId,
            kind:consumer?.kind
          })
        })

        consumer.on('producerresume',async()=>{
          io.to(socket?.id).emit('producerResumed',{
            storageId:data?.storageId,
            socketId:data?.socketId,
            kind:consumer?.kind
          })
        })

          consumer.on('producerclose',async()=>{
          await consumer?.close()
          const consumerItem = consumerTransports.get(data?.storageId)
          const router = consumerItem?.router;
          membersinConsumerRouters[router] -=1;
          io.to(socket?.id).emit('closeConsumer',{socketId:data?.socketId,screenShare:data?.screenShare,producerId:data?.producerId,kind:consumer?.kind})
        })


    }
    catch(err){
        console.log(err)
    }
}

async function handleDisconnect(socketId){
    if(audioLevelObserverUsers.has(socketId)){
    const item = audioLevelObserverUsers.get(socketId)
    try{
    await audioLevelObservers[item?.router]?.removeProducer({producerId:item?.producerId})
    }
    catch(err){
      console.log(err)
    }
  audioLevelObserverUsers.delete(socketId)

  }

  if(producerTransports.has(socketId)){
    const ProducerItem = producerTransports.get(socketId);
    const Transport = ProducerItem?.transport
    await Transport?.close()
    const routerIdx = ProducerItem?.router;
    membersinProducerRouters[routerIdx] -=1;
    const ProducersLeft = producers.filter((producer)=>producer?.socketId===socketId)
    ProducersLeft.forEach((producer)=>{
    producerObjects.delete(producer?.producerId)
    })
    const filterProducers = producers.filter((producer)=>producer?.socketId!==socketId)
    producers = filterProducers
    const filterPipedProducers = pipedProducers?.filter((pipedProducer)=>pipedProducer?.socketId!==socketId)
    pipedProducers = filterPipedProducers;
    producerTransports.delete(socketId)
  }


    if(consumers.has(socketId) && consumers.get(socketId)?.length>0){
      const sockConsumers = consumers.get(socketId)
      for(let i=0;i<sockConsumers?.length;i++){
        if(consumerTransports.has(sockConsumers[i])){
          const consumerItem = consumerTransports.get(sockConsumers[i])
          const transport = consumerItem?.transport;
          const router = consumerItem?.router;
          membersinConsumerRouters[router] -= transport?.consumers?.size;
          for(let [key,value] of transport?.consumers){
           consumerObjects.delete(value?.id)
          }
          await transport?.close()
          consumerTransports.delete(sockConsumers[i])
        }
      }
      consumers.delete(socketId)
    }


    const filterUser = Users.filter((user)=>user?.socketId!==socketId)
    Users = filterUser;

    io.sockets.emit('userLeft',socketId)
}


server.listen(5001,()=>{
    console.log('Server Listening Successfully!')
})