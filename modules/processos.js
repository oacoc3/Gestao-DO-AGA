/* fullwidth-overrides.css
   - Largura total da área de módulos (#app)
   - Cabeçalho mais baixo
   - Formulário mais baixo
   - Sem rolagem de página; somente rolagens internas
*/

/* garante ausência de rolagem global */
html, body { height: 100%; overflow: hidden; }

/* Largura total na área dos módulos (#app) */
#app,
#app .container {
  width: 100%;
  max-width: none;
}

/* respiro lateral */
#app .container {
  padding-left: 16px;
  padding-right: 16px;
}

/* cartões e tabelas ocupam a faixa disponível */
#app .card { width: 100%; }
#app .table { width: 100%; table-layout: fixed; }

/* evita que inputs/selects “estourem” células */
#app table input,
#app table select,
#app table button { max-width: 100%; }

/* Cabeçalho mais baixo (~-60%) */
.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 8px;
  padding-bottom: 8px;
}
.app-header .brand {
  margin: 0;
  line-height: 1.1;
  font-size: 1.6rem;
}

/* Formulário mais baixo */
.proc-form-card { padding-top: 8px !important; padding-bottom: 8px !important; }
.proc-form-row label { margin-bottom: 2px !important; font-size: 0.95rem !important; }
.proc-form-row input,
.proc-form-row select,
.proc-form-row button { height: 34px !important; }

/* Responsivo: reduz levemente o padding lateral em telas pequenas */
@media (max-width: 640px) {
  #app .container { padding-left: 10px; padding-right: 10px; }
}
