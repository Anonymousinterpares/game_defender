import Peer, { DataConnection } from 'peerjs';
import { ConfigManager } from '../config/MasterConfig';

export enum NetworkMessageType {
  PLAYER_STATE = 'ps',
  WORLD_UPDATE = 'wu',
  ENTITY_SPAWN = 'es',
  ENTITY_DESTROY = 'ed',
  PROJECTILE = 'pj',
  CHAT = 'ch',
  WORLD_SEED = 'ws',
  PLAYER_HIT = 'ph',
  EXPLOSION = 'ex',
  PLAYER_DEATH = 'pd',
  WORLD_DAMAGE_REQUEST = 'wdr',
  WORLD_HEAT_SYNC = 'whs',
  PLUGIN_SYNC = 'pls',
  PING_PONG = 'pp'
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
  public myName: string = 'Player';
  private ping: number = 0;

  private log(message: string, ...args: any[]): void {
    if (ConfigManager.getInstance().get<boolean>('Debug', 'extendedLogs')) {
      console.log(message, ...args);
    }
  }

  private warn(message: string, ...args: any[]): void {
    if (ConfigManager.getInstance().get<boolean>('Debug', 'extendedLogs')) {
      console.warn(message, ...args);
    }
  }

  private error(message: string, ...args: any[]): void {
    if (ConfigManager.getInstance().get<boolean>('Debug', 'extendedLogs')) {
      console.error(message, ...args);
    }
  }

  private constructor() { }

  public getPing(): number {
    return this.ping;
  }

  public setPing(value: number): void {
    this.ping = value;
  }

  public static getInstance(): MultiplayerManager {
    if (!MultiplayerManager.instance) {
      MultiplayerManager.instance = new MultiplayerManager();
      (window as any).MultiplayerManagerInstance = MultiplayerManager.instance;
    }
    return MultiplayerManager.instance;
  }

  public init(id?: string): Promise<string> {
    if (this.peer && !this.peer.destroyed && !this.peer.disconnected && this.myId) {
      return Promise.resolve(this.myId);
    }

    if (this.peer && this.peer.disconnected && !this.peer.destroyed) {
      this.peer.reconnect();
      return new Promise((resolve) => {
        const onOpen = (id: string) => {
          this.myId = id;
          resolve(id);
        };
        this.peer!.once('open', onOpen);
      });
    }

    return new Promise((resolve, reject) => {
      const peerId = id || 'neon-' + Math.random().toString(36).substr(2, 6);

      this.peer = new Peer(peerId, {
        debug: 1, // Minimal logs
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
          ]
        }
      });

      this.peer.on('open', (id) => {
        this.myId = id;
        resolve(id);
      });

      this.peer.on('connection', (conn) => {
        this.log('[MP] INCOMING CONNECTION from:', conn.peer);
        this.setupConnection(conn);
      });

      this.peer.on('error', (err) => {
        this.error('[MP] Peer error:', err.type, err);
        reject(err);
      });

      this.peer.on('disconnected', () => this.warn('[MP] Peer disconnected'));
    });
  }

  public host(): void {
    this.isHost = true;
    this.log('[MP] Role: HOST');
  }

  public join(hostId: string): void {
    if (!this.peer) return;
    this.log('[MP] Joining host:', hostId);
    this.isHost = false;
    const conn = this.peer.connect(hostId);
    this.setupConnection(conn);
  }

  private setupConnection(conn: DataConnection): void {
    this.log('[MP] setupConnection for:', conn.peer);

    let isInitialized = false;
    const markAsOpen = () => {
      if (isInitialized) return;
      isInitialized = true;
      this.log('[MP] Connection established with:', conn.peer);
      this.connections.set(conn.peer, conn);
    };

    // Standard PeerJS open event
    conn.on('open', () => {
      this.log('[MP] Connection event: OPEN');
      markAsOpen();
    });

    // Fallback: If we get data, the connection is definitely functional
    conn.on('data', (data: any) => {
      if (!isInitialized) {
        this.log('[MP] Connection fallback: DATA received before OPEN event');
        markAsOpen();
      }
      const msg = data as NetworkMessage;
      // Log critical combat messages
      if (msg.t === 'ph' || msg.t === 'pj') {
        this.log(`[MP] RX ${msg.t} from ${conn.peer} | Data:`, msg.d);
      }

      // Temporary: Log PS to see if coords change
      if (msg.t === 'ps' && Math.random() < 0.05) {
        this.log(`[MP] RX PS sample:`, msg.d);
      }

      this.onMessageCallbacks.forEach(cb => cb(msg, conn));
    });

    conn.on('close', () => {
      this.log('[MP] Connection CLOSED:', conn.peer);
      this.connections.delete(conn.peer);
    });

    conn.on('error', (err) => {
      this.error('[MP] DataConnection ERROR:', err);
    });

    // Immediate check if it's already open (rare but happens)
    if (conn.open) {
      this.log('[MP] Connection already open at setup');
      markAsOpen();
    }
  }

  public broadcast(type: NetworkMessageType, data: any): void {
    if (type === NetworkMessageType.PLAYER_HIT) {
      this.log(`[MP] BROADCASTING PLAYER_HIT`, data);
    }
    const msg: NetworkMessage = { t: type, d: data };
    this.connections.forEach(conn => {
      if (conn.open) {
        conn.send(msg);
      }
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

  public offMessage(cb: (msg: NetworkMessage, conn: DataConnection) => void): void {
    this.onMessageCallbacks = this.onMessageCallbacks.filter(c => c !== cb);
  }

  public clearMessageCallbacks(): void {
    this.onMessageCallbacks = [];
  }

  public disconnect(): void {
    this.connections.forEach(c => c.close());
    this.connections.clear();
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.myId = '';
    this.isHost = false;
    this.onMessageCallbacks = [];
  }

  public getConnectedPeersCount(): number {
    return this.connections.size;
  }
}