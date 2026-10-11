# Formato `.pixelcraft`

Um projeto é um arquivo ZIP com a extensão `.pixelcraft`:

```
mimetype            "application/x-pixelcraft" (primeira entrada, sem compressão)
manifest.json       estrutura do documento (JSON)
images/<id>.png     uma imagem PNG RGBA 8 bits por imagem única
thumbnail.png       miniatura do primeiro quadro (opcional, ignorada ao abrir)
```

## manifest.json (versão 1)

```jsonc
{
  "format": "pixelcraft",
  "version": 1,
  "generator": "PixelCraft 0.1.0",
  "savedAt": "2026-10-11T03:00:00.000Z",
  "document": {
    "id": "D…", "name": "Herói", "width": 32, "height": 32,
    "layers": [            // de baixo para cima
      { "type": "pixel", "id": "L…", "name": "Camada 1", "visible": true, "locked": false,
        "opacity": 100, "blendMode": "normal", "colorTag": null, "exportable": true },
      { "type": "group", "id": "G…", "name": "Grupo", "expanded": true, "children": [ … ], … }
    ],
    "frames": [ { "id": "F…", "duration": 100, "tag": "andar" } ],
    "cels": { "L…/F…": "I…" },            // célula → imagem; ausente = transparente
    "palette": { "id": "…", "name": "…", "colors": ["#rrggbbaa", …] },
    "animation": { "fps": 10, "loop": "loop|once|pingpong", "direction": "forward|reverse" },
    "tiles": { "width": 16, "height": 16, "offsetX": 0, "offsetY": 0 },
    "guides": [ { "axis": "x|y", "position": 8 } ],
    "symmetry": { "horizontal": false, "vertical": false, "axisX": 16, "axisY": 16 }
  },
  "images": { "I…": { "file": "images/I….png", "width": 32, "height": 32 } }
}
```

* Várias células podem apontar para a mesma imagem (células vinculadas).
* Toda imagem tem exatamente as dimensões do documento.
* Cores de paleta são `#RRGGBBAA`.

## Validação ao abrir

O arquivo inteiro é validado antes de qualquer uso:

1. Tamanho máximo do arquivo (1 GiB) e número máximo de entradas (50 000).
2. Somente nomes de entrada da lista permitida são lidos (`mimetype`,
   `manifest.json`, `thumbnail.png`, `images/<id>.png`). Nada é extraído para o
   disco, então nomes como `../../x` não têm efeito (proteção contra *zip slip*).
3. Tamanhos declarados são verificados antes de descompactar; a descompressão
   tem saída limitada (proteção contra *zip bomb*).
4. `manifest.json` é migrado para a versão atual e validado com Zod
   (identificadores, faixas numéricas, limites).
5. Coerência estrutural: IDs únicos, profundidade de grupos, células que
   apontam para camadas de pixels e quadros existentes, imagens existentes com
   as dimensões do documento.
6. Cada PNG tem o cabeçalho lido e conferido antes de ser decodificado; CRCs
   são verificados; o limite total de memória de imagens é 1 GiB.

Qualquer violação gera uma mensagem de erro clara e o arquivo não é aberto.

## Limites

| Limite | Valor | Motivo |
|---|---|---|
| Largura/altura | 4096 px | Pixel art raramente passa de 1024; 4096 cobre tilesets grandes |
| Pixels por quadro | 16,7 M (64 MiB RGBA) | Mantém composição e histórico responsivos |
| Quadros | 1000 | Animações longas sem esgotar memória |
| Camadas | 256 | |
| Profundidade de grupos | 8 | |
| Memória total de imagens | 1 GiB | Proteção contra arquivos maliciosos |
| Duração de quadro | 10 ms a 60 s | Faixa útil para GIF e jogos |

## Versões e migração

O campo `version` é obrigatório. Ao abrir:

* versão maior que a suportada → mensagem pedindo para atualizar o PixelCraft;
* versão menor → migrações encadeadas (`src/project/migrations.ts`), uma por
  versão. A versão 0 (pré-lançamento) é aceita e convertida.

Ao mudar o formato: incremente `CURRENT_FORMAT_VERSION`, adicione a migração
`N → N+1` e um teste com um arquivo da versão anterior.
