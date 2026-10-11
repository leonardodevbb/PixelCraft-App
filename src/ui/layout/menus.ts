import type { MenuDef } from './MenuBar';

/** Menu layout. Only commands that exist in the registry are shown. */
export function buildMenus(): MenuDef[] {
  return [
    {
      label: 'Arquivo',
      items: ['file.new', 'file.open', '-', 'file.save', 'file.saveAs', '-', 'file.exportPng', '-', 'file.newWindow', 'file.close'],
    },
    {
      label: 'Editar',
      items: ['edit.undo', 'edit.redo'],
    },
    {
      label: 'Visualizar',
      items: [
        'view.zoomIn',
        'view.zoomOut',
        'view.actualSize',
        'view.fit',
        'view.fitWidth',
        'view.fitHeight',
        'view.center',
        '-',
        'view.pixelGrid',
        'view.tileGrid',
        '-',
        'view.rightPanel',
        'view.fullscreen',
        { label: 'Tema', items: ['view.theme.dark', 'view.theme.light', 'view.theme.system'] },
      ],
    },
    {
      label: 'Ajuda',
      items: ['help.shortcuts', 'help.docs', '-', 'help.about'],
    },
  ];
}
