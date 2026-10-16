/** Isolated Node 24 deployment target. Do not deploy inside an app/provider secret environment. */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { createConfiguredCoordinator } from './index.ts';
import { assertIsolatedEnvironment, verifyDatabaseIdentity } from './runtime.mjs';
export async function startCoordinatorServer({env=process.env}={}) {
  if(Number(process.versions.node.split('.')[0])!==24) throw new Error('COORDINATION_NODE_24_REQUIRED');
  const connectionString=assertIsolatedEnvironment(env);
  const pool=new pg.Pool({connectionString,max:2,connectionTimeoutMillis:10000,idleTimeoutMillis:10000,statement_timeout:10000});
  const query=(sql,values)=>pool.query(sql,values);
  try {
    await verifyDatabaseIdentity(query);
    const handle=createConfiguredCoordinator({env,query});
    const server=createServer(async(req,res)=>{
      const chunks=[];let bytes=0;
      try {
        for await(const chunk of req) {bytes+=chunk.length;if(bytes>262144) throw new Error('COORDINATION_REQUEST_TOO_LARGE');chunks.push(chunk);}
        const response=await handle(new Request('http://localhost/coordinate',{method:req.method,headers:req.headers,
          ...(req.method!=='GET'&&req.method!=='HEAD'?{body:Buffer.concat(chunks)}:{})}));
        res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
      } catch {res.writeHead(bytes>262144?413:503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:bytes>262144?'COORDINATION_REQUEST_TOO_LARGE':'COORDINATION_UNAVAILABLE'}));}
    });
    const port=Number(env.PORT??8080);if(!Number.isSafeInteger(port)||port<1||port>65535) throw new Error('COORDINATION_PORT_INVALID');
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,resolve);});
    return {server,close:async()=>{await new Promise(resolve=>server.close(resolve));await pool.end();}};
  } catch(error) {await pool.end();throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {const service=await startCoordinatorServer();for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{service.close().then(()=>process.exit(0));});}
  catch {process.stderr.write('COORDINATION_STARTUP_REFUSED\n');process.exitCode=1;}
}
