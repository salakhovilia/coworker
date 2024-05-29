export interface IState {
  companyId: number;
  sourceType: 'gdrive' | 'gcalendar';
  returnTo: IStateReturnTo;
}

export interface IStateReturnTo {
  type: 'telegram';
  chatId: number;
}
