import Peer, { DataConnection } from 'peerjs';

export enum NetworkMessageType {
  PLAYER_STATE = 'ps',
  WORLD_UPDATE = 'wu',
  ENTITY_SPAWN = 'es',
  ENTITY_DESTROY = 'ed',
  PROJECTILE = 'pj',
  CHAT = 'ch'
}

export interface NetworkMessage {
  t: NetworkMessageType;
  d: any;
}

export class MultiplayerManager {
  private static instance: MultiplayerManager;
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private onMessageCallbacks: ((msg: NetworkMessage, conn: DataConnection) => void)[] = [];
  
  public isHost: boolean = false;
  public myId: string = '';

  private constructor() {}

  public static getInstance(): MultiplayerManager {
    if (!MultiplayerManager.instance) {
      MultiplayerManager.instance = new MultiplayerManager();
    }
    return MultiplayerManager.instance;
  }

  public init(id?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // Create a random ID if not provided, prefixed for easier discovery
      const peerId = id || 'neon-' + Math.random().toString(36).substr(2, 6);
      
      this.peer = new Peer(peerId);

      this.peer.on('open', (id) => {
        this.myId = id;
        console.log('PeerJS connected with ID:', id);
        resolve(id);
      });

      this.peer.on('connection', (conn) => {
        this.setupConnection(conn);
      });

      this.peer.on('error', (err) => {
        console.error('PeerJS error:', err);
        reject(err);
      });
    });
  }

  public host(): void {
    this.isHost = true;
    console.log('Acting as Host');
  }

  public join(hostId: string): void {
    if (!this.peer) return;
    this.isHost = false;
    const conn = this.peer.connect(hostId);
    this.setupConnection(conn);
  }

  private setupConnection(conn: DataConnection): void {
    conn.on('open', () => {
      console.log('Connected to:', conn.peer);
      this.connections.set(conn.peer, conn);
    });

    conn.on('data', (data: any) => {
      const msg = data as NetworkMessage;
      this.onMessageCallbacks.forEach(cb => cb(msg, conn));
    });

    conn.on('close', () => {
      console.log('Connection closed:', conn.peer);
      this.connections.delete(conn.peer);
    });
  }

  public broadcast(type: NetworkMessageType, data: any): void {
    const msg: NetworkMessage = { t: type, d: data };
    this.connections.forEach(conn => {
      if (conn.open) conn.send(msg);
    });
  }

  public sendTo(peerId: string, type: NetworkMessageType, data: any): void {
    const conn = this.connections.get(peerId);
    if (conn && conn.open) {
      conn.send({ t: type, d: data });
    }
  }

  public onMessage(cb: (msg: NetworkMessage, conn: DataConnection) => void): void {
    this.onMessageCallbacks.push(cb);
  }

  public disconnect(): void {
    this.connections.forEach(c => c.close());
    this.connections.clear();
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.isHost = false;
    this.onMessageCallbacks = [];
  }

  public getConnectedPeersCount(): number {
    return this.connections.size;
  }
}
