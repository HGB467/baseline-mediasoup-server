import { createConsumeTransport } from "./index.js";

export class ConsumeProcessorQueue{
    constructor(){
        this.data = []
        this.processing = false;
    }

    addItemToProcess(data,socket,callback){
        this.data.push({
            data,
            socket,
            callback
        })
        if(!this.processing){
            this.processing = true;
            this.processItem()
        }
    }

    async processItem(){
      if(this.data.length === 0){
        this.processing = false;
        return;
      }
      const item = this.data[0]
      await createConsumeTransport(item?.data,item?.socket,item?.callback)
      this.data.shift()
      this.processItem()
    }
}