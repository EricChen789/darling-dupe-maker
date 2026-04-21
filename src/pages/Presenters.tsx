import { PresenterManagement } from '@/components/settings/PresenterManagement';

const Presenters = () => {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">提交人資料</h1>
        <p className="text-sm text-muted-foreground">
          管理表格提交人 (Presenter) 資料，用於 NAR1、NR1、ND2A、ND2B 等表格的提交人欄位。
        </p>
      </div>
      <PresenterManagement />
    </div>
  );
};

export default Presenters;
