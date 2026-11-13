import {
  ArrowLeftRight,
  Check,
  Clock,
  FileSearch,
  HandCoins,
  PackageMinus,
  PackageSearch,
  PackageX,
  ReceiptText,
  RefreshCw,
  Trash2,
  Truck,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Arrow, Logo } from '../ui';

/** Taxa de sucesso anunciada. Mantenha igual a DEFAULT_FEE_RATE_BPS na API. */
const SUCCESS_FEE = '20%';

type ToneClass = 't-gold' | 't-blue' | 't-purple' | 't-green';
/** Ordem do sistema de quatro cores: todo grupo de quatro itens segue esta sequência. */
const CYCLE: ToneClass[] = ['t-gold', 't-blue', 't-purple', 't-green'];

const PILLARS: [string, string, LucideIcon, ToneClass][] = [
  ['Auditoria contínua', 'Não é um pente-fino por ano. A cada rodada, todo o histórico ainda contestável é reconferido — e nada é contado duas vezes.', RefreshCw, 't-blue'],
  ['Cada valor explicado', 'Toda divergência traz a memória de cálculo: de onde veio o número, qual evento o gerou e até quando pode ser contestado.', FileSearch, 't-purple'],
  ['Seu tempo de volta', 'Abrimos, documentamos e acompanhamos cada chamado. Você só entra quando o marketplace pede um documento.', Clock, 't-gold'],
  ['Só paga no sucesso', 'Sem adesão e sem mensalidade. A taxa incide apenas sobre o reembolso efetivamente pago.', HandCoins, 't-green'],
];

const STEPS = [
  ['Você conecta a loja', 'Autorize o acesso de leitura aos relatórios do marketplace. Leva poucos minutos e não muda nada na sua operação.'],
  ['Nós auditamos tudo', 'Reconstruímos o saldo de cada SKU e conferimos remessas, remoções, devoluções e cada tarifa cobrada.'],
  ['Nós conduzimos a disputa', 'Cada divergência vira um chamado com evidências. Pedimos documentos só quando o marketplace exige.'],
  ['Você recebe', 'O reembolso cai direto na sua conta de seller. Nossa taxa incide apenas sobre o valor efetivamente pago.'],
];

/** Os oito detectores, agrupados em quatro categorias — uma cor para cada. */
const TYPES: [string, string, LucideIcon, string, ToneClass][] = [
  ['Perda em armazém', 'Unidades que sumiram dentro do centro de distribuição e nunca foram localizadas.', PackageSearch, 'Estoque', 't-blue'],
  ['Dano em armazém', 'Itens vendáveis danificados sob custódia do operador logístico.', PackageX, 'Estoque', 't-blue'],
  ['Descarte indevido', 'Estoque vendável descartado sem que você tenha pedido.', Trash2, 'Estoque', 't-blue'],
  ['Falta em remessa', 'Você enviou 200, o centro contou 188. A diferença tem dono.', Truck, 'Logística', 't-purple'],
  ['Perda em transferência', 'Unidades que saíram de um centro e não chegaram ao outro.', ArrowLeftRight, 'Logística', 't-purple'],
  ['Remoção não entregue', 'Ordens de remoção concluídas com menos unidades do que o solicitado.', PackageMinus, 'Logística', 't-purple'],
  ['Tarifa cobrada a maior', 'Medidas ou peso cadastrados errado geram cobrança acima da tabela.', ReceiptText, 'Tarifas', 't-gold'],
  ['Devolução não recebida', 'O comprador foi reembolsado, mas o produto nunca voltou ao estoque.', Undo2, 'Devoluções', 't-green'],
];

const SECURITY = [
  ['Acesso protegido', 'Senhas com hash scrypt, verificação em duas etapas, bloqueio por tentativas e sessões revogáveis.'],
  ['Credenciais cifradas', 'Chaves de acesso a marketplaces e segredos são guardados com AES-256-GCM.'],
  ['Papéis e permissões', 'Titular, administrador, analista e leitor: cada pessoa vê e faz apenas o que precisa.'],
];

const FAQ = [
  ['Quanto custa?', `Não há mensalidade nem taxa de adesão. Cobramos ${SUCCESS_FEE} sobre o que o marketplace efetivamente reembolsar. Se não recuperarmos nada, você não paga nada.`],
  ['Quais marketplaces são atendidos?', 'A plataforma foi desenhada para operações de fulfillment — Amazon FBA, Mercado Livre Full e similares. Cada marketplace entra por um conector próprio; consulte a disponibilidade para a sua operação.'],
  ['Preciso enviar documentos?', 'Só em parte dos casos. Faltas em remessa costumam exigir nota fiscal de compra e comprovante de entrega; o portal avisa exatamente o que falta e em qual chamado.'],
  ['Em quanto tempo vejo resultado?', 'A primeira auditoria roda assim que a loja é conectada e olha para o histórico ainda contestável. O prazo de resposta de cada chamado depende do marketplace.'],
  ['Posso acompanhar o que está sendo feito?', 'Sim. Cada divergência mostra como o valor foi apurado, e cada chamado tem linha do tempo, documentos e situação atual.'],
];

/**
 * Faixa em movimento contínuo. Hoje mostra o que a Grandir audita; quando houver
 * clientes e parceiros reais (com autorização de uso de marca), é aqui que entram os logos.
 */
function Ticker() {
  const items = (hidden: boolean) =>
    TYPES.map(([title, , Icon, , tone]) => (
      <span className={`item ${tone}`} key={`${title}-${hidden}`} aria-hidden={hidden || undefined}>
        <span className="dot"><Icon aria-hidden="true" /></span>
        {title}
      </span>
    ));
  return (
    <section className="ticker" aria-label="O que a Grandir audita">
      <p className="label">Auditoria contínua de estoque, logística, tarifas e devoluções</p>
      <div className="viewport">
        <div className="track">
          {items(false)}
          {items(true)}
        </div>
      </div>
    </section>
  );
}

export function Landing() {
  return (
    <>
      <header className="site-nav">
        <div className="inner">
          <Logo />
          <nav aria-label="Seções">
            <a href="#como-funciona">Como funciona</a>
            <a href="#o-que-auditamos">O que auditamos</a>
            <a href="#para-quem">Para quem</a>
            <a href="#preco">Preço</a>
            <a href="#seguranca">Segurança</a>
          </nav>
          <div className="row">
            <Link className="signin" to="/entrar">Entrar</Link>
            <Link className="btn sm" to="/criar-conta">Criar conta <Arrow /></Link>
          </div>
        </div>
      </header>

      <section className="hero">
        <div className="container grid">
          <div>
            <span className="eyebrow">Auditoria e recuperação de reembolsos</span>
            <h1 className="display">O que o marketplace te deve, de volta ao seu <span className="highlight">caixa.</span></h1>
            <p className="lead">
              Conciliamos seu estoque. Conferimos cada tarifa. Conduzimos cada disputa até o reembolso. Você
              acompanha tudo em um painel — e só paga quando recebe.
            </p>
            <div className="cta">
              <Link className="btn lg" to="/criar-conta">Começar auditoria <Arrow /></Link>
              <a className="btn ghost lg" href="#como-funciona">Ver como funciona</a>
            </div>
            <p className="fine">Sem mensalidade. Sem fidelidade. Cancele quando quiser.</p>
          </div>
          <div className="hero-art" aria-hidden="true">
            <span className="shape leaf t-purple s1" />
            <span className="shape bar t-green s2" />
            <span className="shape bar t-blue s3" />
            <span className="shape bar t-gold s4" />
            <span className="shape leaf t-green s5" />
            <div className="mock">
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
        </div>
      </section>

      <Ticker />

      <section className="section cream manifesto">
        <div className="container">
          <span className="eyebrow">Por que auditar</span>
          <h2 className="display">Toda operação de fulfillment perde dinheiro em silêncio.</h2>
          <p className="sub">
            Uma caixa contada a menos, um item danificado no armazém, uma tarifa calculada com a medida errada.
            Nenhum desses valores chama atenção sozinho — e quase ninguém tem tempo de conferir linha por linha.
          </p>
          <p className="triad">
            Nós
            <span className="highlight t-blue">encontramos.</span>
            <span className="highlight t-purple">contestamos.</span>
            <span className="highlight t-green">recuperamos.</span>
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <span className="eyebrow">O que você ganha</span>
          <h2 className="display">Recuperação de receita como <span className="highlight t-green">rotina,</span> não como mutirão.</h2>
          <div className="pillars">
            {PILLARS.map(([title, text, Icon, tone]) => (
              <article className={`pillar ${tone}`} key={title}>
                <div className="icon-box"><Icon aria-hidden="true" /></div>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section cream" id="como-funciona">
        <div className="container">
          <span className="eyebrow">Como funciona</span>
          <h2 className="display">Do relatório ao reembolso, em <span className="highlight">quatro passos.</span></h2>
          <p className="sub">Você conecta a loja uma vez. A partir daí, a auditoria é contínua e cada real encontrado tem rastro.</p>
          <div className="steps">
            {STEPS.map(([title, text], index) => (
              <div className={`step ${CYCLE[index]}`} key={title}>
                <span className="tag">Passo 0{index + 1}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="o-que-auditamos">
        <div className="container">
          <span className="eyebrow">O que auditamos</span>
          <h2 className="display">Oito tipos de divergência que passam <span className="highlight t-purple">despercebidos.</span></h2>
          <p className="sub">Cada um tem regra, prazo de contestação e evidência própria. Os motores da Grandir tratam todos.</p>
          <div className="types">
            {TYPES.map(([title, text, Icon, category, tone]) => (
              <div className={`type ${tone}`} key={title}>
                <div className="top">
                  <div className="glyph"><Icon size={20} aria-hidden="true" /></div>
                  <span className="tag">{category}</span>
                </div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section cream" id="para-quem">
        <div className="container">
          <span className="eyebrow">Para quem</span>
          <h2 className="display">Da primeira loja à operação com várias marcas.</h2>
          <div className="audience">
            <div className="who" style={{ background: 'var(--paper)' }}>
              <div className="tags"><span className="tag t-gold">Uma loja</span><span className="tag t-green">Sem esforço</span></div>
              <h3>Sellers e pequenas operações</h3>
              <p>
                Você cuida de compra, anúncio, atendimento e logística. Auditar o marketplace linha a linha não cabe
                na semana. A Grandir faz isso por você e mostra o resultado em uma tela.
              </p>
              <Link className="btn" to="/criar-conta">Criar conta <Arrow /></Link>
            </div>
            <div className="who dark">
              <div className="tags"><span className="tag t-purple">Várias lojas</span><span className="tag t-blue">Equipe com papéis</span></div>
              <h3>Marcas, agências e operações maiores</h3>
              <p>
                Várias lojas, várias pessoas, vários níveis de acesso. Convide a equipe com papéis definidos,
                acompanhe cada chamado e feche o mês com a fatura detalhada reembolso a reembolso.
              </p>
              <Link className="btn" to="/criar-conta">Criar conta <Arrow /></Link>
            </div>
          </div>
        </div>
      </section>

      <section className="section dark" id="preco">
        <div className="container split">
          <div>
            <span className="eyebrow">Preço</span>
            <h2 className="display">Se você não recupera, a gente não cobra.</h2>
            <p className="sub">
              Nosso modelo é por taxa de sucesso: o incentivo da Grandir é exatamente o seu — encontrar mais e
              recuperar mais.
            </p>
          </div>
          <div className="price-card">
            <div className="rate">{SUCCESS_FEE}</div>
            <p>sobre o valor efetivamente reembolsado</p>
            <ul className="ticks">
              <li>Sem adesão e sem mensalidade</li>
              <li>Auditoria contínua de estoque, tarifas e devoluções</li>
              <li>Abertura e acompanhamento de todos os chamados</li>
              <li>Fatura mensal detalhada chamado a chamado</li>
            </ul>
            <Link className="btn block lg" to="/criar-conta" style={{ marginTop: 26 }}>Criar conta <Arrow /></Link>
          </div>
        </div>
      </section>

      <section className="section" id="seguranca">
        <div className="container">
          <span className="eyebrow">Segurança</span>
          <h2 className="display">Dados financeiros pedem cuidado de <span className="highlight t-blue">instituição financeira.</span></h2>
          <div className="trust">
            <div className="panel t-blue">
              <h3>Somente leitura. Dados isolados.</h3>
              <p>A auditoria lê relatórios — não altera anúncios, preços nem estoque. E o que é seu fica só com você.</p>
              <ul>
                <li><Check aria-hidden="true" />Cada conta opera em um espaço isolado: toda consulta é filtrada pelo cliente autenticado, por construção.</li>
                <li><Check aria-hidden="true" />Entradas, mudanças de acesso, chamados e downloads ficam em trilha de auditoria.</li>
                <li><Check aria-hidden="true" />Nenhum rastreador de publicidade no site nem no portal.</li>
              </ul>
            </div>
            <div className="panel t-green">
              <div className="giant">R$ 0</div>
              <h3>para começar</h3>
              <p>Sem adesão, sem mensalidade, sem fidelidade. Você só paga sobre reembolso efetivamente recebido.</p>
            </div>
          </div>
          <div className="security-grid" style={{ marginTop: 20 }}>
            {SECURITY.map(([title, text]) => (
              <div className="item" key={title}><h3>{title}</h3><p>{text}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="section cream">
        <div className="container">
          <span className="eyebrow">Perguntas frequentes</span>
          <h2 className="display">Antes de começar.</h2>
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
            <span className="shape bar t-blue c1" aria-hidden="true" />
            <span className="shape bar t-purple c2" aria-hidden="true" />
            <span className="shape bar t-green c3" aria-hidden="true" />
            <span className="shape leaf t-gold c4" aria-hidden="true" />
            <h2 className="display">Descubra quanto está <span className="highlight">parado</span> no marketplace.</h2>
            <Link className="btn lg" to="/criar-conta">Começar auditoria <Arrow /></Link>
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <div className="container">
          <div className="cols">
            <div>
              <Logo />
              <p>Auditoria financeira, conciliação de estoque e recuperação de reembolsos para sellers de marketplaces.</p>
            </div>
            <div>
              <h4>Produto</h4>
              <ul>
                <li><a href="#como-funciona">Como funciona</a></li>
                <li><a href="#o-que-auditamos">O que auditamos</a></li>
                <li><a href="#para-quem">Para quem</a></li>
                <li><a href="#preco">Preço</a></li>
                <li><a href="#seguranca">Segurança</a></li>
              </ul>
            </div>
            <div>
              <h4>Conta</h4>
              <ul>
                <li><Link to="/entrar">Entrar</Link></li>
                <li><Link to="/criar-conta">Criar conta</Link></li>
                <li><Link to="/recuperar-senha">Recuperar senha</Link></li>
              </ul>
            </div>
          </div>
          <p className="legal">© {new Date().getFullYear()} Grandir. Todos os direitos reservados. Marketplaces citados são marcas de seus respectivos titulares.</p>
        </div>
      </footer>
    </>
  );
}
