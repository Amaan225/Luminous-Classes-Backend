// Best effort while the existing web process is awake. No extra hosting service.
function startAlertLoop({service,enabled=false,intervalMs=60000,schedule=setInterval,clear=clearInterval,onError=()=>{}}={}){
 if(!enabled||!service)return ()=>{};
 let running=false,stopped=false;
 const tick=async()=>{if(running||stopped)return;running=true;try{await service.scanApproved();if(!stopped)await service.drain({limit:20,realDelivery:true});}catch{onError('Tutor alert processing incomplete; queued work will retry.');}finally{running=false;}};
 const timer=schedule(tick,intervalMs);timer.unref?.();
 return ()=>{stopped=true;clear(timer);};
}
module.exports={startAlertLoop};
