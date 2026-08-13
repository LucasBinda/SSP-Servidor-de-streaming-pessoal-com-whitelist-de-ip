const os = require('os');
const net = require('net');
const { logManager } = require('./logManager');

// Monitor de conectividade de rede — com sondagem de WAN (internet de verdade).
//
// O que resolve: quando a máquina perde a rede, o os.networkInterfaces() fica
// sem endereço externo (só loopback) — e o boot do server.js, que só imprime
// "IPv4/IPv6: http://..." QUANDO acha um IP, não fala nada. O servidor sobe
// mudo, respondendo só em 127.0.0.1, sem pista de que a rede caiu. Esta classe
// fecha o buraco: acompanha a conectividade num loop e avisa (rede.log +
// terminal) QUANDO cai e QUANDO volta — e, ao voltar, repete os endereços.
//
// Dois níveis, do mais barato pro mais preciso:
//   1. INTERFACE (os.networkInterfaces, síncrono): existe um IPv4/IPv6 roteável?
//      Se nem isso há, está offline na hora — nem vale sondar.
//   2. WAN (sondarWan, assíncrono): com a interface no ar, tenta ALCANÇAR a
//      internet de fato. Distingue "LAN no ar mas internet fora" (queda de ISP,
//      WAN do roteador caída) de conectividade real — o que a checagem de
//      interface sozinha não pega.
//
// Edge-triggered + histerese: guarda o último estado e só loga na TRANSIÇÃO; e
// uma sondagem ruim isolada (um pacote perdido) NÃO derruba — precisa de
// FALHAS_PARA_OFFLINE seguidas. Sem isso, o log viraria um festival de
// "caiu/voltou" a cada ruído. Classe testável (interface, sonda e log
// injetáveis) + instância compartilhada, no desenho de CoverPicker/LogManager.

// Intervalo entre verificações. A sondagem WAN é mais pesada que ler interface
// (faz uma conexão de rede), então uma cadência mais folgada que a de antes.
const INTERVALO_MS = 15 * 1000;

// Teto de espera de cada tentativa de conexão. OBRIGATÓRIO: sem ele, com a rede
// caída o socket fica pendurado até o timeout do TCP do SO (20s+) e o loop trava.
const TIMEOUT_SONDAGEM_MS = 4000;

// Histerese: quantas sondagens ruins SEGUIDAS antes de declarar a queda. A volta
// é imediata (primeira boa já religa).
const FALHAS_PARA_OFFLINE = 2;

const MSG_SEM_REDE =
  'sem conexão com a internet — fale com seu administrador de rede para saber o que aconteceu';

// Alvos da sondagem: IPs ANYCAST públicos e estáveis. "Anycast" = o MESMO IP é
// anunciado de vários pontos do mundo ao mesmo tempo, e o roteamento da internet
// te leva ao mais próximo — por isso nunca "caem" e respondem de qualquer lugar,
// ideais pra um teste de alcance. Conectar num IP (não num nome) testa a ROTA
// até a internet sem depender de DNS, que pode ser justamente o que caiu. Online
// se QUALQUER um responder; 443 e 53 quase nunca são bloqueadas na saída.
const ALVOS_WAN = [
  { host: '1.1.1.1', port: 443 }, // Cloudflare (resolver público 1.1.1.1)
  { host: '8.8.8.8', port: 53 },  // Google (Google Public DNS)
];

// Uma tentativa: resolve true se o TCP abre dentro do timeout; false em timeout
// ou erro. `feito` blinda contra eventos que ainda disparem depois de resolver.
function tentarAlvo({ host, port }) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    let feito = false;
    const fim = (ok) => {
      if (feito) return;
      feito = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(TIMEOUT_SONDAGEM_MS);
    sock.once('connect', () => fim(true));
    sock.once('timeout', () => fim(false));
    sock.once('error', () => fim(false));
  });
}

// WAN alcançável? Corre os alvos em paralelo; basta um abrir.
async function sondarWan() {
  const resultados = await Promise.all(ALVOS_WAN.map(tentarAlvo));
  return resultados.some(Boolean);
}

class NetworkConnection {
  constructor({
    listarInterfaces = () => os.networkInterfaces(),
    sondar = sondarWan,
    logger = logManager,
  } = {}) {
    this.listarInterfaces = listarInterfaces;
    this.sondar = sondar;
    this.logger = logger;
    this.porta = null;
    this.online = null;        // null = ainda não avaliado (primeira verificação define)
    this.falhasSeguidas = 0;   // sondagens ruins consecutivas (histerese)
    this.sondando = false;     // evita sondagens sobrepostas
    this.timer = null;
  }

  // Primeiro IPv4 e IPv6 não-internos — MESMA regra do boot: ignora loopback
  // (internal) e link-local IPv6 (fe80::, não roteável e exigiria zone-id na
  // URL). Recalcula a cada chamada, refletindo o estado atual da rede.
  enderecos() {
    const interfaces = Object.values(this.listarInterfaces()).flat();
    const ipv4 = interfaces.find((i) => i && !i.internal && i.family === 'IPv4');
    const ipv6 = interfaces.find((i) => i && !i.internal && i.family === 'IPv6' && !i.address.startsWith('fe80'));
    return { ipv4, ipv6 };
  }

  // Há alguma interface roteável? (só loopback = sem rede). É o porteiro barato
  // antes da sondagem WAN.
  temRede() {
    const { ipv4, ipv6 } = this.enderecos();
    return Boolean(ipv4 || ipv6);
  }

  // URLs "http://IP:porta" pra copiar e colar — IPv6 entre colchetes (sintaxe
  // obrigatória de URL). Vazio quando não há endereço externo.
  linhasDeAcesso() {
    const { ipv4, ipv6 } = this.enderecos();
    const linhas = [];
    if (ipv4) linhas.push(`IPv4: http://${ipv4.address}:${this.porta}`);
    if (ipv6) linhas.push(`IPv6: http://[${ipv6.address}]:${this.porta}`);
    return linhas;
  }

  // Inicia o monitor: uma verificação imediata (que define e loga o estado de
  // boot) + o loop. Boot COM internet fica quieto — o server.js imprime os
  // endereços logo depois.
  iniciar(porta) {
    this.porta = porta;
    this.verificar();
    this.timer = setInterval(() => this.verificar(), INTERVALO_MS);
    this.timer.unref(); // não segura o processo no shutdown
    return this;
  }

  // Uma verificação: porteiro de interface -> sondagem WAN -> histerese -> loga
  // só na transição.
  async verificar() {
    if (this.sondando) return; // uma sondagem em curso já vai concluir
    this.sondando = true;
    try {
      // Sem interface roteável nem adianta sondar: offline na hora.
      const alcancavel = this.temRede() ? await this.sondar() : false;

      if (alcancavel) {
        this.falhasSeguidas = 0;
      } else {
        this.falhasSeguidas++;
        // Histerese: só cai após N falhas seguidas — EXCETO na primeira
        // avaliação (online ainda null), que é imediata pra não esconder um
        // servidor que subiu já sem internet.
        if (this.online !== null && this.falhasSeguidas < FALHAS_PARA_OFFLINE) return;
      }

      if (alcancavel === this.online) return; // sem transição

      const boot = this.online === null;
      this.online = alcancavel;

      // Boot COM internet: silêncio (o server.js já mostra os endereços). Todo o
      // resto — queda, volta, ou boot SEM internet — vira linha no log/terminal.
      if (boot && alcancavel) return;
      if (alcancavel) {
        const acesso = this.linhasDeAcesso().join(' · ') || '(nenhum endereço externo encontrado)';
        this.logger.rede(true, `rede de volta — acesse em: ${acesso}`);
      } else {
        this.logger.rede(false, MSG_SEM_REDE);
      }
    } finally {
      this.sondando = false;
    }
  }

  // Encerra o loop (usado em teste; no processo real o unref() já libera).
  parar() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

const networkConnection = new NetworkConnection();

module.exports = { NetworkConnection, networkConnection, MSG_SEM_REDE, FALHAS_PARA_OFFLINE };
