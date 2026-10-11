<p align="center">
  <img src="assets/branding/png/pixelcraft-logo-on-light.png" alt="PixelCraft" width="480">
</p>

**PixelCraft** é um editor de pixel art e animação quadro a quadro para Linux,
pensado para quem está começando e rápido para quem já desenha sprites.
Funciona offline, guarda os projetos apenas no seu computador e não tem
telemetria.

> Status: em desenvolvimento ativo. Veja o andamento por fase em
> [docs/ROADMAP.md](docs/ROADMAP.md).

## Funcionalidades (Fase 1)

* Canvas com grade lógica de pixels, zoom (12,5% a 12 800%) em torno do cursor,
  pan (Espaço, botão do meio ou ferramenta Mão), ajustar à tela/largura/altura.
* Lápis, pincel com opacidade, borracha, linha, retângulo e elipse (contorno e
  preenchidos), conta-gotas. Shift trava ângulos/proporções; Alt desenha a
  partir do centro; traços rápidos não deixam falhas.
* Cores primária/secundária (botão esquerdo/direito), seletor HSV com HEX,
  RGBA e HSL, cores recentes e paleta padrão "PixelCraft 32".
* Simetria horizontal/vertical.
* Desfazer/refazer por traço, com orçamento de memória.
* Projetos `.pixelcraft` (ZIP versionado com manifesto JSON e PNG por imagem),
  gravação atômica e verificada, lista de recentes com miniaturas.
* Exportação PNG com transparência ou fundo sólido e escala inteira.
* Salvamento automático em área de recuperação separada.
* Temas escuro/claro/sistema, atalhos de teclado, tooltips com atalho.

## Requisitos

* Linux x86_64 com glibc 2.31+ (Ubuntu 20.04+, Debian 11+, Fedora 36+ ou
  equivalente) para os pacotes.
* Para desenvolver: Node.js 22+ e npm 10+.

## Desenvolvimento

```bash
npm install          # dependências
npm run dev          # executa com recarga automática
npm run typecheck    # TypeScript estrito
npm run lint         # ESLint
npm test             # testes unitários
npm run test:e2e     # testes de interface (precisa de display; use xvfb-run em servidores)
npm run build        # build de produção (dist/ e dist-electron/)
npm start            # executa o build de produção
```

## Pacotes Linux

Veja [docs/BUILD_LINUX.md](docs/BUILD_LINUX.md).

```bash
npm run package:deb        # release/pixelcraft_<versão>_amd64.deb
npm run package:appimage   # release/PixelCraft-<versão>-x86_64.AppImage
npm run package:flatpak    # release/PixelCraft-<versão>.flatpak
```

## Documentação

* [Arquitetura](docs/ARCHITECTURE.md)
* [Formato .pixelcraft](docs/PROJECT_FORMAT.md)
* [Build dos pacotes Linux](docs/BUILD_LINUX.md)
* [Testes](docs/TESTING.md)
* [Atalhos](docs/SHORTCUTS.md)
* [Roadmap](docs/ROADMAP.md)
* [Como contribuir](CONTRIBUTING.md)

## Licença

MIT, veja [LICENSE](LICENSE). Logotipo, ícones e a fonte bitmap
"PixelCraft Sans 5×7" foram criados para o projeto e seguem a mesma licença.
As dependências e suas licenças estão listadas em
[docs/THIRD_PARTY.md](docs/THIRD_PARTY.md).
