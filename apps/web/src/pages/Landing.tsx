import { Link } from 'react-router-dom';
import { Logo } from '../ui';

/** Taxa de sucesso anunciada. Mantenha igual a DEFAULT_FEE_RATE_BPS na API. */
const SUCCESS_FEE = '20%';

const STEPS = [
  ['Conecte sua loja', 'Autorize o acesso de leitura aos relatórios do marketplace. Leva poucos minutos e não muda nada na sua operação.'],
  ['Auditamos tudo', 'Reconstruímos o saldo de cada SKU, conferimos remessas, remoções, devoluções e cada tarifa cobrada — de forma contínua.'],
  ['Conduzimos a disputa', 'Cada divergência vira um chamado com evidências. Pedimos documentos só quando o marketplace exige.'],
  ['Você recebe', 'O reembolso cai direto na sua conta de seller. Nossa taxa incide apenas sobre o valor efetivamente pago.'],
];

const TYPES = [
  ['Perda em armazém', 'Unidades que sumiram dentro do centro de distribuição e nunca foram localizadas.'],
  ['Dano em armazém', 'Itens vendáveis danificados sob custódia do operador logístico.'],
  ['Descarte indevido', 'Estoque vendável descartado sem que você tenha pedido.'],
  ['Falta em remessa', 'Você enviou 200, o centro contou 188. A diferença tem dono.'],
  ['Perda em transferência', 'Unidades que saíram de um centro e não chegaram ao outro.'],
  ['Remoção não entregue', 'Ordens de remoção concluídas com menos unidades do que o solicitado.'],
  ['Tarifa cobrada a maior', 'Medidas ou peso cadastrados errado geram cobrança acima da tabela.'],
  ['Devolução não recebida', 'O comprador foi reembolsado, mas o produto nunca voltou ao estoque.'],
];

const SECURITY = [
  ['Seus dados são só seus', 'Cada conta opera em um espaço isolado: toda consulta é filtrada pelo cliente autenticado, por construção.'],
  ['Acesso protegido', 'Senhas com hash scrypt, verificação em duas etapas, bloqueio por tentativas e sessões revogáveis.'],
  ['Credenciais cifradas', 'Chaves de acesso a marketplaces e segredos são guardados com AES-256-GCM.'],
  ['Papéis e permissões', 'Titular, administrador, analista e leitor: cada pessoa vê e faz apenas o que precisa.'],
  ['Trilha de auditoria', 'Entradas, alterações de acesso, chamados e downloads ficam registrados e consultáveis.'],
  ['Somente leitura', 'A auditoria lê relatórios. Não altera anúncios, preços nem estoque.'],
];

const FAQ = [
  ['Quanto custa?', `Não há mensalidade nem taxa de adesão. Cobramos ${SUCCESS_FEE} sobre o que o marketplace efetivamente reembolsar. Se não recuperarmos nada, você não paga nada.`],
  ['Quais marketplaces são atendidos?', 'A plataforma foi desenhada para operações de fulfillment — Amazon FBA, Mercado Livre Full e similares. Cada marketplace entra por um conector próprio; consulte a disponibilidade para a sua operação.'],
  ['Preciso enviar documentos?', 'Só em parte dos casos. Faltas em remessa costumam exigir nota fiscal de compra e comprovante de entrega; o portal avisa exatamente o que falta e em qual chamado.'],
  ['Em quanto tempo vejo resultado?', 'A primeira auditoria roda assim que a loja é conectada e olha para o histórico ainda contestável. O prazo de resposta de cada chamado depende do marketplace.'],
  ['Posso acompanhar o que está sendo feito?', 'Sim. Cada divergência mostra como o valor foi apurado, e cada chamado tem linha do tempo, documentos e situação atual.'],
];

export function Landing() {
  return (
    <>
      <header className="site-nav">
        <div className="inner">
          <Logo />
          <nav aria-label="Seções">
            <a href="#como-funciona">Como funciona</a>
            <a href="#o-que-auditamos">O que auditamos</a>
            <a href="#preco">Preço</a>
            <a href="#seguranca">Segurança</a>
          </nav>
          <div className="row">
            <Link className="btn on-dark sm" to="/entrar">Entrar</Link>
            <Link className="btn lime sm" to="/criar-conta">Criar conta</Link>
          </div>
        </div>
      </header>

      <section className="hero">
        <div className="container grid">
          <div>
            <span className="eyebrow">Auditoria e recuperação de reembolsos</span>
            <h1>O que o marketplace te deve, <em>de volta ao seu caixa.</em></h1>
            <p className="lead">
              A Grandir concilia seu estoque, confere cada tarifa e conduz as disputas até o reembolso. Você
              acompanha tudo em um painel — e só paga quando recebe.
            </p>
            <div className="cta">
              <Link className="btn lime lg" to="/criar-conta">Começar auditoria</Link>
              <a className="btn on-dark lg" href="#como-funciona">Ver como funciona</a>
            </div>
            <p className="fine">Sem mensalidade. Sem fidelidade. Cancele quando quiser.</p>
          </div>
          <div className="mock" aria-hidden="true">
            <div className="label">Recuperado nos últimos 12 meses</div>
            <div className="big num">R$ 48.920,00</div>
            <div className="bars">
              {[28, 40, 34, 52, 46, 60, 55, 72, 64, 80, 76, 96].map((h, i) => (
                <span key={i} style={{ height: `${h}%` }} />
              ))}
            </div>
            <div className="line-item"><span>Falta em remessa · GRD-00214</span><span className="badge success">Pago</span></div>
            <div className="line-item"><span>Tarifa cobrada a maior · GRD-00231</span><span className="badge info">Em análise</span></div>
            <div className="line-item"><span>Perda em armazém · GRD-00240</span><span className="badge warn">Aguardando documentos</span></div>
            <div className="caption">Ilustração do painel com valores fictícios.</div>
          </div>
        </div>
      </section>

      <section className="section" id="como-funciona">
        <div className="container">
          <span className="eyebrow">Como funciona</span>
          <h2>Do relatório ao reembolso, em quatro passos.</h2>
          <p className="sub">Você conecta a loja uma vez. A partir daí, a auditoria é contínua e cada real encontrado tem rastro.</p>
          <div className="steps">
            {STEPS.map(([title, text]) => (
              <div className="step" key={title}><h3>{title}</h3><p>{text}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="section alt" id="o-que-auditamos">
        <div className="container">
          <span className="eyebrow">O que auditamos</span>
          <h2>Oito tipos de divergência que passam despercebidos.</h2>
          <p className="sub">Cada um tem regra, prazo de contestação e evidência própria. Os motores da Grandir tratam todos.</p>
          <div className="types">
            {TYPES.map(([title, text]) => (
              <div className="type" key={title}><h3>{title}</h3><p>{text}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="section dark" id="preco">
        <div className="container split">
          <div>
            <span className="eyebrow">Preço</span>
            <h2>Se você não recupera, a gente não cobra.</h2>
            <p className="sub">
              Nosso modelo é por taxa de sucesso: o incentivo da Grandir é exatamente o seu — encontrar mais e
              recuperar mais.
            </p>
          </div>
          <div className="price-card">
            <div className="rate">{SUCCESS_FEE}</div>
            <p className="muted">sobre o valor efetivamente reembolsado</p>
            <ul className="ticks">
              <li>Sem adesão e sem mensalidade</li>
              <li>Auditoria contínua de estoque, tarifas e devoluções</li>
              <li>Abertura e acompanhamento de todos os chamados</li>
              <li>Fatura mensal detalhada chamado a chamado</li>
            </ul>
            <Link className="btn block lg" to="/criar-conta" style={{ marginTop: 26 }}>Criar conta</Link>
          </div>
        </div>
      </section>

      <section className="section" id="seguranca">
        <div className="container">
          <span className="eyebrow">Segurança</span>
          <h2>Dados financeiros pedem cuidado de instituição financeira.</h2>
          <div className="security-grid">
            {SECURITY.map(([title, text]) => (
              <div className="item" key={title}><h3>{title}</h3><p>{text}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="section alt">
        <div className="container">
          <span className="eyebrow">Perguntas frequentes</span>
          <h2>Antes de começar.</h2>
          <div className="faq">
            {FAQ.map(([question, answer]) => (
              <details key={question}><summary>{question}</summary><p>{answer}</p></details>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="cta-band">
            <h2>Descubra quanto está parado no marketplace.</h2>
            <Link className="btn lime lg" to="/criar-conta">Começar auditoria</Link>
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <div className="container inner">
          <Logo />
          <span>© {new Date().getFullYear()} Grandir. Marketplaces citados são marcas de seus respectivos titulares.</span>
        </div>
      </footer>
    </>
  );
}
