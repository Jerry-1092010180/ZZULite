// Only explicit school flags or human-readable labels; never infer from score or duplicate courses.
export function attemptTags(row: Record<string, unknown>): string[] {
    let makeup = row.isMakeup === true || row.isMakeUp === true || row.isResit === true;
    let retake = row.isRetake === true || row.isReStudy === true || row.isRestudy === true;
    const fields = ['examType', 'examTypeName', 'examNature', 'examNatureName', 'examTypeNameZh', 'examCategory', 'gradeType', 'gradeTypeName', 'courseTakeType', 'courseTakeTypeName', 'studyType', 'studyTypeName', 'courseName', 'courseNameZh'];
    for (const field of fields) {
        const value = row[field];
        const item = value && typeof value === 'object' ? value as Record<string, unknown> : null;
        const name = item ? item.nameZh || item.name || item.label : value;
        if (typeof name !== 'string')
            continue;
        // Negative or ambiguous labels must not create a positive badge.
        const label = name.replace(/无需补考|不需补考|非补考|无需重修|不需重修|非重修/g, '');
        if (/补考|缓补考|make[ -]?up|resit/i.test(label))
            makeup = true;
        if (/重修|retake|re[ -]?study/i.test(label))
            retake = true;
    }
    return [...(makeup ? ['补考'] : []), ...(retake ? ['重修'] : [])];
}
