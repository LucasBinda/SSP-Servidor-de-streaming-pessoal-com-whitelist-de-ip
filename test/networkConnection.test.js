const { test } = require('node:test');
const assert = require('node:assert');
const { NetworkConnection, MSG_SEM_REDE, FALHAS_PARA_OFFLINE } = require('../lib/networkConnection');

// os.networkInterfaces() fake — os testes trocam `estado.valor` pra simular a
// interface subindo/caindo.
function fonte(estado) {
  return () => estado.valor;
}

const SO_LOOPBACK = {
  lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
};
const COM_IPV4 = {
  lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  eth0: [{ address: '192.168.0.10', family: 'IPv4', internal: false }],
};
const COM_IPV6 = {
  lo: [{ address: '::1', family: 'IPv6', internal: true }],
  eth0: [
    { address: 'fe80::1', family: 'IPv6', internal: false }, // link-local: deve ser ignorado
    { address: '2001:db8::1', family: 'IPv6', internal: false },
  ],
};

// Logger fake que só guarda as chamadas de rede().
function fakeLogger() {
  const chamadas = [];
  return { chamadas, rede: (online, mensagem) => chamadas.push({ online, mensagem }) };
}

// Sonda WAN fake: devolve estado.valor (bool) e conta as chamadas — pra provar
// que o porteiro de interface pula a sondagem quando não há rede.
function fakeSonda(estado) {
  const f = async () => { f.chamadas++; return estado.valor; };
  f.chamadas = 0;
  return f;
}

test('temRede: só loopback = sem rede; IP externo = com rede', () => {
  const estado = { valor: SO_LOOPBACK };
  const nc = new NetworkConnection({ listarInterfaces: fonte(estado) });
  assert.equal(nc.temRede(), false);
  estado.valor = COM_IPV4;
  assert.equal(nc.temRede(), true);
});

test('enderecos: ignora loopback e link-local fe80::', () => {
  const nc = new NetworkConnection({ listarInterfaces: () => COM_IPV6 });
  const { ipv4, ipv6 } = nc.enderecos();
  assert.equal(ipv4, undefined);
  assert.equal(ipv6.address, '2001:db8::1');
});

test('linhasDeAcesso: monta http://IP:porta (IPv6 entre colchetes)', () => {
  const nc4 = new NetworkConnection({ listarInterfaces: () => COM_IPV4 });
  nc4.porta = 5000;
  assert.deepEqual(nc4.linhasDeAcesso(), ['IPv4: http://192.168.0.10:5000']);

  const nc6 = new NetworkConnection({ listarInterfaces: () => COM_IPV6 });
  nc6.porta = 5000;
  assert.deepEqual(nc6.linhasDeAcesso(), ['IPv6: http://[2001:db8::1]:5000']);
});

test('porteiro: sem interface roteável NÃO sonda a WAN e cai offline na hora', async () => {
  const logger = fakeLogger();
  const sonda = fakeSonda({ valor: true }); // mesmo "online", não deve ser chamada
  const nc = new NetworkConnection({ listarInterfaces: () => SO_LOOPBACK, sondar: sonda, logger });
  await nc.verificar();
  assert.equal(sonda.chamadas, 0);
  assert.equal(nc.online, false);
  assert.equal(logger.chamadas.length, 1);
  assert.equal(logger.chamadas[0].online, false);
  assert.equal(logger.chamadas[0].mensagem, MSG_SEM_REDE);
});

test('boot COM internet: silêncio (server.js mostra os endereços)', async () => {
  const logger = fakeLogger();
  const nc = new NetworkConnection({ listarInterfaces: () => COM_IPV4, sondar: fakeSonda({ valor: true }), logger });
  await nc.verificar();
  assert.equal(nc.online, true);
  assert.equal(logger.chamadas.length, 0);
});

test('boot com interface mas SEM internet: avisa imediatamente', async () => {
  const logger = fakeLogger();
  const nc = new NetworkConnection({ listarInterfaces: () => COM_IPV4, sondar: fakeSonda({ valor: false }), logger });
  await nc.verificar();
  assert.equal(nc.online, false);
  assert.equal(logger.chamadas.length, 1);
  assert.equal(logger.chamadas[0].online, false);
});

test('histerese: falha isolada não derruba; N seguidas sim; volta na 1ª boa', async () => {
  const sondaEstado = { valor: true };
  const logger = fakeLogger();
  const nc = new NetworkConnection({ listarInterfaces: () => COM_IPV4, sondar: fakeSonda(sondaEstado), logger });
  nc.porta = 5000;

  await nc.verificar(); // boot online -> silêncio
  assert.equal(nc.online, true);
  assert.equal(logger.chamadas.length, 0);

  sondaEstado.valor = false;
  for (let i = 0; i < FALHAS_PARA_OFFLINE - 1; i++) await nc.verificar(); // ainda dentro da margem
  assert.equal(nc.online, true);
  assert.equal(logger.chamadas.length, 0);

  await nc.verificar(); // completa a N-ésima falha -> cai
  assert.equal(nc.online, false);
  assert.equal(logger.chamadas.length, 1);
  assert.equal(logger.chamadas[0].online, false);

  sondaEstado.valor = true;
  await nc.verificar(); // volta na primeira sondagem boa, citando o endereço
  assert.equal(nc.online, true);
  assert.equal(logger.chamadas.length, 2);
  assert.equal(logger.chamadas[1].online, true);
  assert.match(logger.chamadas[1].mensagem, /192\.168\.0\.10:5000/);
});

test('iniciar: guarda a porta e agenda o loop', () => {
  const nc = new NetworkConnection({
    listarInterfaces: () => SO_LOOPBACK,
    sondar: fakeSonda({ valor: false }),
    logger: fakeLogger(),
  });
  nc.iniciar(5000);
  assert.equal(nc.porta, 5000);
  assert.ok(nc.timer);
  nc.parar();
  assert.equal(nc.timer, null);
});
